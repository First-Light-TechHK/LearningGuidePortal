import type { ProductUser, ProductOrder } from "./productStore";
import { attachStripeCheckoutSession, createPendingDemoOrder, createPendingDemoTrialOrder, createPendingDemoTrialOrderFromQuote, createPendingStripeOrder, createPendingStripeTrialOrderFromQuote, createQuote, getQuoteForUser, prepareStripeCheckout } from "./productStore";
import { createHostedCheckout, createHostedTrialCheckout, getStripe } from "./stripeClient";
import { validateSubscriptionPrice } from "./stripePriceService";
import { PaymentError } from "@/contracts/payment";
import { appEnvironment, isProductionEnvironment, paymentMode, publicAppOrigin, runtimeConfiguration } from "./runtimeConfig";
import { startStripeUpgradePayment } from "./stripeUpgradePayment";
import type { OrderReceipt } from "@/contracts/order-receipt";

export type CheckoutRequest = { quoteId?: string; planId?: string; courseId?: string; locale?: "en-GB" | "zh-CN"; consents?: { renewal?: boolean; terms?: boolean; refund?: boolean } };

// Resolve only identities recorded on the authenticated user's paid Order.
export async function stripeOrderReceipt(order: Pick<ProductOrder, "id" | "userId" | "status" | "kind" | "paymentMode" | "amountMinor" | "currency" | "stripeInvoiceId" | "stripePaymentIntentId" | "stripeCheckoutSessionId" | "stripeSubscriptionId"> & { plan?: { name: string } | null }): Promise<OrderReceipt | null> {
  if (order.status !== "paid" || order.kind === "trial_activation" || order.paymentMode !== "stripe") return null;
  const stripe = getStripe();
  const receipt = (paidAt?: number | null): OrderReceipt => ({ orderId: order.id, planName: order.plan?.name || "", amountMinor: order.amountMinor, currency: order.currency, paidAt: paidAt ? new Date(paidAt * 1000).toISOString() : null, paymentMode: "stripe" });
  const invoiceReceipt = (invoice: import("stripe").Stripe.Invoice) => {
    const subscription = invoice.parent?.subscription_details?.subscription;
    const subscriptionId = typeof subscription === "string" ? subscription : subscription?.id;
    if (invoice.status !== "paid" || invoice.currency !== order.currency || invoice.amount_paid !== order.amountMinor
      || order.stripeSubscriptionId && subscriptionId !== order.stripeSubscriptionId
      || invoice.metadata?.orderId && invoice.metadata.orderId !== order.id
      || invoice.metadata?.userId && invoice.metadata.userId !== order.userId) return null;
    return receipt(invoice.status_transitions?.paid_at);
  };
  if (order.stripeInvoiceId) {
    const invoice = await stripe.invoices.retrieve(order.stripeInvoiceId);
    return invoice.id === order.stripeInvoiceId ? invoiceReceipt(invoice) : null;
  }
  let paymentIntentId = order.stripePaymentIntentId;
  // Subscription Checkout sessions have an Invoice, and normally no direct
  // PaymentIntent. Older orders kept only the session identity.
  if (!order.stripeInvoiceId && !paymentIntentId && order.stripeCheckoutSessionId) {
    const session = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId);
    const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (session.id !== order.stripeCheckoutSessionId || session.status !== "complete" || session.payment_status !== "paid"
      || session.amount_total !== order.amountMinor || session.currency !== order.currency
      || order.stripeSubscriptionId && subscriptionId !== order.stripeSubscriptionId
      || session.metadata?.orderId && session.metadata.orderId !== order.id
      || session.metadata?.userId && session.metadata.userId !== order.userId) return null;
    if (session.invoice) {
      const invoice = typeof session.invoice === "string" ? await stripe.invoices.retrieve(session.invoice) : session.invoice;
      return invoiceReceipt(invoice);
    }
    paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  }
  if (!paymentIntentId) return null;
  const payment = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
  if (payment.id !== paymentIntentId || payment.status !== "succeeded" || payment.amount_received !== order.amountMinor || payment.currency !== order.currency || !payment.latest_charge) return null;
  const charge = typeof payment.latest_charge === "string" ? await stripe.charges.retrieve(payment.latest_charge) : payment.latest_charge;
  return charge.paid && !charge.refunded && charge.amount === order.amountMinor && charge.currency === order.currency ? receipt(charge.created) : null;
}

// Both HTTPS hosts serve the DEV Portal (see dev-deploy.yml). Keep this
// allowlist specific to that deployment, rather than trusting proxy headers
// or treating arbitrary www/apex names as interchangeable.
const devCheckoutOrigins = ["https://www.ilovelearningguide.com", "https://ilovelearningguide.com"];

export function checkoutRequestOrigin(request: Request) {
  const configured = publicAppOrigin(request);
  const supplied = request.headers.get("origin");
  // Resolve public origins before loopback: a container's internal request URL
  // may be localhost even when the browser is on the configured HTTPS site.
  if (supplied === configured) return configured;
  if (appEnvironment() === "DEV" && devCheckoutOrigins.includes(configured) && supplied && devCheckoutOrigins.includes(supplied)) return supplied;
  const target = new URL(request.url);
  // Local Next.js may run on another port or loopback alias. Only accept
  // the actual request origin; never trust forwarded hosts or arbitrary Origin.
  const local = appEnvironment() === "DEV" && target.protocol === "http:"
    && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  if (local && supplied === target.origin) return target.origin;
  throw new PaymentError("origin_mismatch", 403);
}

export async function startPayment(user: ProductUser, body: CheckoutRequest, request: Request, trial = false) {
  const mode = paymentMode();
  if (!["demo", "stripe"].includes(mode) || (isProductionEnvironment() && mode !== "stripe")) throw new PaymentError("payment_unavailable", 503);
  if (mode === "stripe" && !runtimeConfiguration().payment.configured) throw new PaymentError("payment_unavailable", 503);
  const origin = checkoutRequestOrigin(request);
  if (body.consents?.renewal !== true || body.consents.terms !== true || body.consents.refund !== true) throw new PaymentError("consent_required");
  const locale = body.locale === "zh-CN" ? "zh-CN" : "en-GB";
  if (trial && !body.quoteId) {
    if (mode === "demo") {
      const pending = await createPendingDemoTrialOrder(user.id, body.planId || "", body.courseId);
      return { order: pending.order, checkoutUrl: `/${locale}/portal/payment/checkout?orderId=${encodeURIComponent(pending.order.id)}` };
    }
    body = { ...body, quoteId: (await createQuote(user.id, body.planId || "", "trial")).quote.id };
  }
  const quoted = await getQuoteForUser(user.id, body.quoteId || "");
  if (!quoted || (trial ? quoted.quote.kind !== "trial" : quoted.quote.kind === "trial")) throw new PaymentError("quote_expired");
  const upgrade = quoted.quote.kind === "upgrade";
  if (upgrade) {
    if (mode !== "stripe" || !quoted.quote.upgradeProration) throw new PaymentError("quote_expired");
    return startStripeUpgradePayment(user.id, quoted, origin, locale);
  }
  if (mode === "demo") {
    const pending = trial ? await createPendingDemoTrialOrderFromQuote(user.id, quoted.quote.id)
      : await createPendingDemoOrder(user.id, quoted.quote.id);
    return { order: pending.order, checkoutUrl: `/${locale}/portal/payment/checkout?orderId=${encodeURIComponent(pending.order.id)}` };
  }
  const price = quoted.quote.price;
  if (!price) throw new PaymentError("quote_expired");
  // Retrieve the pinned ID, not a lookup key that could have been transferred since quoting.
  const remotePrice = await getStripe().prices.retrieve(price.stripePriceId);
  validateSubscriptionPrice(remotePrice, price.termMonths);
  if (remotePrice.unit_amount !== price.amountMinor || remotePrice.currency !== price.currency) throw new PaymentError("quote_expired");
  const pending = trial ? await createPendingStripeTrialOrderFromQuote(user.id, quoted.quote.id)
    : await createPendingStripeOrder(user.id, quoted.quote.id);
  const order = await prepareStripeCheckout(user.id, pending.order.id, origin, locale);
  if (order.status === "paid") return { order, checkoutUrl: `/${locale}/account/my-learning/subscription?orderId=${encodeURIComponent(order.id)}` };
  if (order.stripeCheckoutSessionId) {
    const session = await getStripe().checkout.sessions.retrieve(order.stripeCheckoutSessionId);
    if (session.status === "expired") throw new PaymentError("quote_expired");
    if (session.status === "complete") return { order, checkoutUrl: `/${locale}/account/my-learning/subscription?orderId=${encodeURIComponent(order.id)}` };
    if (session.url) return { order, checkoutUrl: session.url };
  }
  const input = { origin: order.checkoutOrigin!, locale: order.checkoutLocale!, userEmail: user.email, orderId: order.id, userId: user.id, quoteId: order.quoteId, planId: pending.plan.id, courseId: pending.plan.courseId, scopeType: pending.plan.scope, scopeId: pending.plan.scopeId || pending.plan.category, planName: pending.plan.name, amountMinor: price.amountMinor, currency: price.currency, termMonths: price.termMonths, price };
  const session = trial ? await createHostedTrialCheckout(input) : await createHostedCheckout(input);
  await attachStripeCheckoutSession(user.id, order.id, session.id);
  return { order: { ...order, stripeCheckoutSessionId: session.id }, checkoutUrl: session.url };
}

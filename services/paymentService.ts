import type { ProductUser } from "./productStore";
import { attachStripeCheckoutSession, completeDemoUpgradeOrder, createPendingDemoOrder, createPendingDemoTrialOrder, createPendingDemoTrialOrderFromQuote, createPendingDemoUpgradeOrderFromQuote, createPendingStripeOrder, createPendingStripeTrialOrderFromQuote, createPendingStripeUpgradeOrderFromQuote, createQuote, getQuoteForUser, prepareStripeCheckout } from "./productStore";
import { createHostedCheckout, createHostedTrialCheckout, createHostedUpgradeCheckout, getStripe } from "./stripeClient";
import { validateSubscriptionPrice } from "./stripePriceService";
import { PaymentError } from "@/contracts/payment";
import { isProductionEnvironment, paymentMode, publicAppOrigin, runtimeConfiguration } from "./runtimeConfig";

export type CheckoutRequest = { quoteId?: string; planId?: string; courseId?: string; locale?: "en-GB" | "zh-CN"; consents?: { renewal?: boolean; terms?: boolean; refund?: boolean } };

export async function startPayment(user: ProductUser, body: CheckoutRequest, request: Request, trial = false) {
  const mode = paymentMode();
  if (!["demo", "stripe"].includes(mode) || (isProductionEnvironment() && mode !== "stripe")) throw new PaymentError("payment_unavailable", 503);
  if (mode === "stripe" && !runtimeConfiguration().payment.configured) throw new PaymentError("payment_unavailable", 503);
  const origin = publicAppOrigin(request);
  if (request.headers.get("origin") !== origin) throw new PaymentError("invalid_request", 403);
  if (!body.consents?.renewal || !body.consents.terms || !body.consents.refund) throw new PaymentError("invalid_request");
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
  if (mode === "demo") {
    const pending = trial ? await createPendingDemoTrialOrderFromQuote(user.id, quoted.quote.id)
      : upgrade ? await createPendingDemoUpgradeOrderFromQuote(user.id, quoted.quote.id) : await createPendingDemoOrder(user.id, quoted.quote.id);
    if (upgrade && quoted.quote.amountMinor === 0) {
      const result = await completeDemoUpgradeOrder(user.id, pending.order.id);
      return { order: result.order, checkoutUrl: `/${locale}/account/my-learning` };
    }
    return { order: pending.order, checkoutUrl: `/${locale}/portal/payment/checkout?orderId=${encodeURIComponent(pending.order.id)}` };
  }
  const price = quoted.quote.price;
  if (!price) throw new PaymentError("quote_expired");
  // Retrieve the pinned ID, not a lookup key that could have been transferred since quoting.
  const remotePrice = await getStripe().prices.retrieve(price.stripePriceId);
  validateSubscriptionPrice(remotePrice, price.termMonths);
  if (remotePrice.unit_amount !== price.amountMinor || remotePrice.currency !== price.currency) throw new PaymentError("quote_expired");
  if (upgrade) {
    const source = quoted.sourceSubscription;
    if (!source?.stripeSubscriptionId || !source.stripeCustomerId) throw new PaymentError("invalid_request");
    const remote = await getStripe().subscriptions.retrieve(source.stripeSubscriptionId);
    const customer = typeof remote.customer === "string" ? remote.customer : remote.customer.id;
    const current = remote.items.data[0]?.price;
    if (customer !== source.stripeCustomerId || remote.status !== "active" || remote.cancel_at_period_end || remote.items.data.length !== 1
      || current.recurring?.interval !== remotePrice.recurring?.interval || current.recurring?.interval_count !== remotePrice.recurring?.interval_count) throw new PaymentError("invalid_request");
  }
  const pending = trial ? await createPendingStripeTrialOrderFromQuote(user.id, quoted.quote.id)
    : upgrade ? await createPendingStripeUpgradeOrderFromQuote(user.id, quoted.quote.id) : await createPendingStripeOrder(user.id, quoted.quote.id);
  const order = await prepareStripeCheckout(user.id, pending.order.id, origin, locale);
  if (order.status === "paid") return { order, checkoutUrl: `/${locale}/portal/payment/success?orderId=${encodeURIComponent(order.id)}` };
  if (order.stripeCheckoutSessionId) {
    const session = await getStripe().checkout.sessions.retrieve(order.stripeCheckoutSessionId);
    if (session.status === "expired") throw new PaymentError("quote_expired");
    if (session.status === "complete") return { order, checkoutUrl: `/${locale}/portal/payment/success?orderId=${encodeURIComponent(order.id)}` };
    if (session.url) return { order, checkoutUrl: session.url };
  }
  const input = { origin: order.checkoutOrigin!, locale: order.checkoutLocale!, userEmail: user.email, orderId: order.id, userId: user.id, quoteId: order.quoteId, planId: pending.plan.id, courseId: pending.plan.courseId, scopeType: pending.plan.scope, scopeId: pending.plan.scopeId || pending.plan.category, planName: pending.plan.name, amountMinor: price.amountMinor, currency: price.currency, termMonths: price.termMonths, price };
  const session = trial ? await createHostedTrialCheckout(input) : upgrade
    ? await createHostedUpgradeCheckout({ ...input, amountMinor: order.amountMinor, sourceSubscriptionId: quoted.quote.sourceSubscriptionId! })
    : await createHostedCheckout(input);
  await attachStripeCheckoutSession(user.id, order.id, session.id);
  return { order: { ...order, stripeCheckoutSessionId: session.id }, checkoutUrl: session.url };
}

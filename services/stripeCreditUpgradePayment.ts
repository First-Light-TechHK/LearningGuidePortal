import type Stripe from "stripe";
import { isDeepStrictEqual } from "node:util";
import { PaymentError } from "@/contracts/payment";
import { getStripe } from "./stripeClient";
import { resolveUpgradeCredit } from "./stripeUpgradeCreditPrice";
import { invoiceSubscription, stripeIdentity } from "./stripeUpgradeProration";
import { applyVerifiedStripeEvent, attachStripeCheckoutSession, createPendingStripeUpgradeOrderFromQuote, getQuoteForUser,
  pendingUpgradeCancellations, prepareStripeCheckout, recordUpgradeCancellation, stripeOrderContext, type ProductOrder } from "./productStore";

export async function startCreditUpgradePayment(userId: string, quoted: NonNullable<Awaited<ReturnType<typeof getQuoteForUser>>>, origin: string, locale: "en-GB" | "zh-CN") {
  const credit = quoted.quote.upgradeCredit, price = quoted.quote.price;
  if (!credit || !price) throw new PaymentError("quote_expired");
  const returnUrl = (id: string) => `/${locale}/account/my-learning/subscription?orderId=${encodeURIComponent(id)}`;
  if (quoted.upgradeOrder?.status === "paid") return { order: quoted.upgradeOrder, checkoutUrl: returnUrl(quoted.upgradeOrder.id) };
  if (quoted.upgradeOrder && quoted.upgradeOrder.status !== "pending") throw new PaymentError("quote_expired");
  if (!quoted.upgradeOrder?.stripeCheckoutSessionId) {
    if (Date.parse(quoted.quote.expiresAt) <= Date.now()) throw new PaymentError("quote_expired");
    const current = await resolveUpgradeCredit({ sourceOrderId: credit.sourceOrderId, subscriptionId: credit.sourceStripeSubscriptionId,
      customerId: credit.customerId, sourcePriceId: credit.sourcePriceId, paidAmountMinor: credit.creditMinor, price });
    if (!isDeepStrictEqual(current, credit)) throw new PaymentError("quote_expired");
  }
  const pending = await createPendingStripeUpgradeOrderFromQuote(userId, quoted.quote.id);
  const order = await prepareStripeCheckout(userId, pending.order.id, origin, locale);
  if (order.status === "paid") return { order, checkoutUrl: returnUrl(order.id) };
  const stripe = getStripe();
  if (order.stripeCheckoutSessionId) {
    const existing = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId);
    if (existing.status === "complete") {
      await reconcileCreditUpgradeCheckout({ id: `credit-checkout:${existing.id}`, type: "checkout.session.retrieved" }, existing.id);
      return { order, checkoutUrl: returnUrl(order.id) };
    }
    if (existing.status !== "open" || !existing.url) throw new PaymentError("quote_expired");
    return { order, checkoutUrl: existing.url };
  }
  const metadata = { app: "learning_guide", kind: "upgrade_credit", purchase_type: "UPGRADE", orderId: order.id, userId, quoteId: order.quoteId,
    planId: order.planId, target_plan: price.termMonths === 6 ? "EVERYTHING_6M" : "EVERYTHING_12M",
    source_order_id: credit.sourceOrderId, source_subscription_id: credit.sourceStripeSubscriptionId };
  const session = await stripe.checkout.sessions.create({ mode: "subscription", customer: credit.customerId,
    locale: order.checkoutLocale === "zh-CN" ? "zh" : "en-GB", client_reference_id: order.id, payment_method_types: ["card"],
    ...(process.env.STRIPE_SANDBOX === "1" ? { managed_payments: { enabled: false }, adaptive_pricing: { enabled: false } } : {}),
    line_items: [{ price: price.stripePriceId, quantity: 1 }], discounts: [{ coupon: credit.couponId }],
    metadata, subscription_data: { metadata }, success_url: `${order.checkoutOrigin}/${order.checkoutLocale}/account/my-learning/subscription?orderId=${encodeURIComponent(order.id)}`,
    cancel_url: `${order.checkoutOrigin}/${order.checkoutLocale}/portal/subscription/confirmation?quoteId=${encodeURIComponent(order.quoteId)}`,
  }, { idempotencyKey: `learning-guide-credit-upgrade-${order.id}` });
  if (!session.url) throw new PaymentError("payment_unavailable", 502);
  await attachStripeCheckoutSession(userId, order.id, session.id);
  return { order: { ...order, stripeCheckoutSessionId: session.id }, checkoutUrl: session.url };
}

export function validateCreditCheckoutIdentity(order: ProductOrder, session: Stripe.Checkout.Session) {
  const credit = order.upgradeCredit, meta = session.metadata;
  if (!credit || session.mode !== "subscription" || stripeIdentity(session.customer) !== credit.customerId
    || meta?.app !== "learning_guide" || meta.kind !== "upgrade_credit" || meta.orderId !== order.id || meta.userId !== order.userId
    || meta.quoteId !== order.quoteId || meta.planId !== order.planId || meta.source_order_id !== credit.sourceOrderId
    || meta.source_subscription_id !== credit.sourceStripeSubscriptionId
    || order.stripeCheckoutSessionId && order.stripeCheckoutSessionId !== session.id
    || session.currency !== "usd" || session.amount_subtotal !== credit.listAmountMinor
    || session.total_details?.amount_discount !== credit.creditMinor || session.total_details.amount_shipping !== 0
    || !Number.isSafeInteger(session.total_details.amount_tax) || session.total_details.amount_tax < 0
    || session.amount_total === null || session.amount_total < credit.amountDueMinor || session.amount_total > credit.amountDueMinor + session.total_details.amount_tax
    || !session.discounts || session.discounts.length !== 1 || stripeIdentity(session.discounts[0].coupon) !== credit.couponId
    || session.discounts[0].promotion_code
    || !session.line_items || session.line_items.has_more || session.line_items.data.length !== 1
    || session.line_items.data[0].quantity !== 1 || session.line_items.data[0].price?.id !== order.price?.stripePriceId
    || process.env.STRIPE_SANDBOX === "1" && session.livemode) throw new Error("Upgrade Checkout mismatch.");
}

export async function reconcileCreditUpgradeCheckout(event: { id: string; type: string }, sessionId: string) {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["line_items", "subscription"] });
  const context = await stripeOrderContext(session.metadata?.orderId || "");
  if (!context?.order.upgradeCredit) throw new Error("Upgrade order not available yet.");
  const order = context.order, credit = order.upgradeCredit!;
  validateCreditCheckoutIdentity(order, session);
  if (session.status === "expired" || event.type === "checkout.session.async_payment_failed" && session.payment_status !== "paid") {
    return applyVerifiedStripeEvent({ ...event, action: "failed_checkout", orderId: order.id, status: session.status === "expired" ? "expired" : "failed" });
  }
  if (session.status !== "complete" || session.payment_status !== "paid") return { pending: true };
  const subscriptionId = stripeIdentity(session.subscription), invoiceId = stripeIdentity(session.invoice);
  if (!subscriptionId || subscriptionId === credit.sourceStripeSubscriptionId || !invoiceId) throw new Error("Upgrade subscription mismatch.");
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const invoice = await stripe.invoices.retrieve(invoiceId, { expand: ["discounts"] });
  const line = invoice.lines.data[0], discounts = invoice.discounts;
  const exclusiveTax = (invoice.total_taxes || []).filter(tax => tax.tax_behavior === "exclusive").reduce((sum, tax) => sum + tax.amount, 0);
  if (stripeIdentity(subscription.customer) !== credit.customerId || subscription.metadata.orderId !== order.id
    || subscription.items.data.length !== 1 || subscription.items.data[0].price.id !== order.price?.stripePriceId
    || subscription.status !== "active" && order.status !== "paid"
    || invoiceSubscription(invoice) !== subscriptionId || stripeIdentity(invoice.customer) !== credit.customerId
    || invoice.status !== "paid" || invoice.billing_reason !== "subscription_create" || invoice.currency !== "usd"
    || invoice.subtotal !== credit.listAmountMinor || invoice.total !== session.amount_total || invoice.amount_paid !== invoice.total
    || invoice.total !== credit.amountDueMinor + exclusiveTax || exclusiveTax < 0
    || (invoice.total_taxes || []).reduce((sum, tax) => sum + tax.amount, 0) !== session.total_details!.amount_tax
    || invoice.total_discount_amounts?.reduce((sum, item) => sum + item.amount, 0) !== credit.creditMinor
    || discounts.length !== 1 || typeof discounts[0] === "string" || stripeIdentity(discounts[0].source.coupon) !== credit.couponId
    || !line || invoice.lines.has_more || invoice.lines.data.length !== 1 || line.pricing?.price_details?.price !== order.price?.stripePriceId
    || !line.period.start || line.period.end <= line.period.start) throw new Error("Upgrade invoice mismatch.");
  const paymentIntentId = (await stripe.invoicePayments.list({ invoice: invoice.id, status: "paid", limit: 10 })).data
    .map(item => stripeIdentity(item.payment.payment_intent)).find(Boolean);
  const result = order.status === "paid" ? { duplicate: true } : await applyVerifiedStripeEvent({ ...event, action: "credit_upgrade", orderId: order.id,
    sessionId, subscriptionId, invoiceId, customerId: credit.customerId, amountMinor: invoice.amount_paid, currency: invoice.currency,
    taxAmountMinor: exclusiveTax, subscriptionStatus: subscription.status,
    paymentIntentId, periodStart: new Date(line.period.start * 1000).toISOString(), periodEnd: new Date(line.period.end * 1000).toISOString() });
  const latest = await stripeOrderContext(order.id);
  if (latest?.order.upgradeCancellation?.state === "pending") await cancelSupersededSubscription(latest.order);
  return result;
}

async function cancelSupersededSubscription(order: ProductOrder) {
  const credit = order.upgradeCredit;
  if (!credit || !["paid", "refunded"].includes(order.status) || !order.stripeSubscriptionId || order.stripeSubscriptionId === credit.sourceStripeSubscriptionId) return;
  try {
    const stripe = getStripe(), source = await stripe.subscriptions.retrieve(credit.sourceStripeSubscriptionId);
    if (source.id !== credit.sourceStripeSubscriptionId || stripeIdentity(source.customer) !== credit.customerId
      || process.env.STRIPE_SANDBOX === "1" && source.livemode) throw new Error("Source mismatch.");
    if (source.status !== "canceled") {
      const canceled = await stripe.subscriptions.cancel(source.id, { invoice_now: false, prorate: false });
      if (canceled.id !== source.id || canceled.status !== "canceled") throw new Error("Cancellation not confirmed.");
    }
    await recordUpgradeCancellation(order.id, true);
  } catch {
    await recordUpgradeCancellation(order.id, false);
    console.warn(JSON.stringify({ type: "payment", event: "upgrade_action_required", orderId: order.id }));
  }
}

export async function retryUpgradeCancellations() {
  for (const order of (await pendingUpgradeCancellations()).slice(0, 20)) await cancelSupersededSubscription(order);
}

export function startUpgradeCancellationJobs() {
  if (process.env.PAYMENT_MODE !== "stripe" || process.env.NEXT_PHASE === "phase-production-build") return;
  const flag = globalThis as typeof globalThis & { __lgUpgradeCancellationTimer?: ReturnType<typeof setInterval> };
  if (flag.__lgUpgradeCancellationTimer) return;
  let running = false;
  flag.__lgUpgradeCancellationTimer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await retryUpgradeCancellations(); }
    catch { console.warn(JSON.stringify({ type: "payment", event: "upgrade_retry_unavailable" })); }
    finally { running = false; }
  }, 30000);
  flag.__lgUpgradeCancellationTimer.unref();
}

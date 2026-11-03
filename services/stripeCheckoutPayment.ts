import type Stripe from "stripe";
import { applyVerifiedStripeEvent, stripeOrderContext, assertStripeUpgradeAllowed, listPendingStripeCategoryCheckouts } from "./productStore";
import { getStripe } from "./stripeClient";

const identifier = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id;
const iso = (value: number | null | undefined) => value ? new Date(value * 1000).toISOString() : undefined;

export async function reconcileStripeCheckout(event: { id: string; type: string }, sessionId: string) {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["line_items", "subscription"] });
  if (session.metadata?.app !== "learning_guide") return { ignored: true };
  const context = await stripeOrderContext(session.metadata.orderId);
  if (!context) throw new Error("Order is not available yet.");
  const { order } = context;
  if (session.metadata.userId !== order.userId || session.metadata.quoteId !== order.quoteId || session.metadata.planId !== order.planId
    || (order.stripeCheckoutSessionId && order.stripeCheckoutSessionId !== session.id)) throw new Error("Checkout identity mismatch.");
  if (session.status === "expired" || event.type === "checkout.session.async_payment_failed" && session.payment_status !== "paid") {
    return applyVerifiedStripeEvent({ id: event.id, type: event.type, action: "failed_checkout", orderId: order.id, status: session.status === "expired" ? "expired" : "failed" });
  }
  const upgrade = order.kind === "upgrade";
  if (session.status !== "complete" || !["paid", "no_payment_required"].includes(session.payment_status)) return { pending: true };
  if (!order.price || session.currency !== order.currency || session.amount_total !== order.amountMinor) throw new Error("Checkout amount mismatch.");
  const lines = session.line_items;
  if (!lines || lines.has_more || lines.data.length !== 1 || lines.data[0].quantity !== 1) throw new Error("Checkout items mismatch.");
  let subscription: Stripe.Subscription;
  if (upgrade) {
    if (order.upgradePrice && (lines.data[0].price?.id !== order.upgradePrice.stripePriceId || order.amountMinor !== order.upgradePrice.amountMinor)) throw new Error("Upgrade price mismatch.");
    if (session.mode !== "payment" || session.payment_status !== "paid" || !context.source?.stripeSubscriptionId) throw new Error("Invalid upgrade payment.");
    await assertStripeUpgradeAllowed(order.id);
    subscription = await stripe.subscriptions.retrieve(context.source.stripeSubscriptionId);
    if (identifier(subscription.customer) !== context.source.stripeCustomerId || subscription.items.data.length !== 1) throw new Error("Upgrade subscription mismatch.");
    // Keep the existing renewal anchor; Checkout collects only the price difference.
    if (subscription.items.data[0].price.id !== order.price.stripePriceId) {
      subscription = await stripe.subscriptions.update(subscription.id, { items: [{ id: subscription.items.data[0].id, price: order.price.stripePriceId }], proration_behavior: "none" }, { idempotencyKey: "learning-guide-upgrade-subscription-" + order.id });
    }
  } else {
    if (session.mode !== "subscription" || lines.data[0].price?.id !== order.price.stripePriceId) throw new Error("Checkout price mismatch.");
    const subscriptionId = identifier(session.subscription);
    if (!subscriptionId) throw new Error("Checkout subscription missing.");
    subscription = typeof session.subscription === "object" && session.subscription ? session.subscription : await stripe.subscriptions.retrieve(subscriptionId);
  }
  if (subscription.items.data.length !== 1) throw new Error("Unexpected subscription items.");
  const item = subscription.items.data[0];
  let periodStart = iso(item.current_period_start);
  let periodEnd = iso(order.kind === "trial_activation" ? subscription.trial_end : item.current_period_end);
  if (!upgrade && order.kind !== "trial_activation" && session.invoice) {
    const initialInvoice = typeof session.invoice === "string" ? await stripe.invoices.retrieve(session.invoice) : session.invoice;
    const line = initialInvoice.lines.data.find(item => item.pricing?.price_details?.price === order.price!.stripePriceId);
    if (!line || initialInvoice.lines.has_more) throw new Error("Initial invoice period unavailable.");
    periodStart = iso(line.period.start);
    periodEnd = iso(line.period.end);
  }
  const result = await applyVerifiedStripeEvent({ id: event.id, type: event.type, action: "checkout", orderId: order.id, sessionId: session.id,
    subscriptionId: subscription.id, customerId: identifier(subscription.customer), paymentIntentId: identifier(session.payment_intent),
    trial: order.kind === "trial_activation", subscriptionStatus: subscription.status, cancelAtPeriodEnd: subscription.cancel_at_period_end,
    periodStart, periodEnd });
  return result;
}

// Refresh only the signed-in user's recorded Checkouts. Provider state, rather
// than quote age or a browser cancellation, decides whether a reservation ends.
export async function reconcilePendingStripeCategoryCheckouts(userId: string) {
  for (const order of await listPendingStripeCategoryCheckouts(userId)) {
    await reconcileStripeCheckout({ id: `checkout-retrieved:${order.stripeCheckoutSessionId}`, type: "checkout.session.retrieved" }, order.stripeCheckoutSessionId!);
  }
}

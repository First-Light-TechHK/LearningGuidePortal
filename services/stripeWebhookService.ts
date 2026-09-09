import { processLegacyStripeEvent } from "./stripeLegacyWebhookService";
import type Stripe from "stripe";
import { applyVerifiedStripeEvent, stripeOrderContext, isLegacyStripeSubscription, isSnapshotStripeCheckout } from "./productStore";
import { getStripe } from "./stripeClient";

const identifier = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id;
const iso = (value: number | null | undefined) => value ? new Date(value * 1000).toISOString() : undefined;

async function checkoutEvent(event: { id: string; type: string }, sessionId: string) {
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
    if (session.mode !== "payment" || session.payment_status !== "paid" || !context.source?.stripeSubscriptionId) throw new Error("Invalid upgrade payment.");
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

export async function processStripeWebhook(rawBody: string, signature: string) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("Webhook unavailable.");
  const stripe = getStripe();
  const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  if (process.env.STRIPE_SANDBOX === "1" && event.livemode) throw new Error("Live events are not allowed in this sandbox.");
  const object = event.data.object as unknown as { metadata?: Record<string, string> };
  if (event.type.startsWith("checkout.session.") && object.metadata?.app !== "learning_guide" && !await isSnapshotStripeCheckout((event.data.object as Stripe.Checkout.Session).id)) return processLegacyStripeEvent(event);
  if (["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired"].includes(event.type)) return checkoutEvent(event, (event.data.object as Stripe.Checkout.Session).id);
  if (["invoice.paid", "invoice.payment_failed"].includes(event.type)) {
    const incoming = event.data.object as Stripe.Invoice;
    const incomingSubscription = identifier(incoming.parent?.subscription_details?.subscription) || identifier((incoming as unknown as { subscription?: string }).subscription);
    if (incomingSubscription && await isLegacyStripeSubscription(incomingSubscription)) return processLegacyStripeEvent(event);
    const invoice = await stripe.invoices.retrieve((event.data.object as Stripe.Invoice).id);
    const legacy = invoice as unknown as { subscription?: string | { id: string }; payment_intent?: string | { id: string } };
    const subscriptionId = identifier(invoice.parent?.subscription_details?.subscription) || identifier(legacy.subscription);
    if (!subscriptionId) return { ignored: true };
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    if (subscription.metadata.app !== "learning_guide") return processLegacyStripeEvent(event);
    // An invoice can arrive before Checkout: reconcile the trusted Checkout first.
    const sessions = await stripe.checkout.sessions.list({ subscription: subscriptionId, limit: 1 });
    if (!sessions.data[0]) throw new Error("Checkout not available yet.");
    await checkoutEvent({ ...event, id: "checkout:" + sessions.data[0].id, type: "checkout.session.completed" }, sessions.data[0].id);
    if (invoice.currency !== "usd") throw new Error("Invoice currency mismatch.");
    const line = invoice.lines.data.find(item => item.pricing?.price_details?.price === subscription.items.data[0]?.price.id) || invoice.lines.data[0];
    if (!line || invoice.lines.has_more) throw new Error("Invoice period unavailable.");
    const paymentIntentId = identifier(legacy.payment_intent) || (await stripe.invoicePayments.list({ invoice: invoice.id, status: "paid", limit: 10 })).data
      .map(item => identifier(item.payment.payment_intent)).find(Boolean);
    const result = await applyVerifiedStripeEvent({ id: event.id, type: event.type, action: "invoice", subscriptionId, invoiceId: invoice.id,
      amountMinor: invoice.amount_paid, currency: invoice.currency, status: invoice.status || undefined, billingReason: invoice.billing_reason,
      subscriptionStatus: subscription.status, cancelAtPeriodEnd: subscription.cancel_at_period_end,
      paymentIntentId, periodStart: iso(line.period.start), periodEnd: iso(line.period.end) });
    return result;
  }
  if (["customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
    const subscription = await stripe.subscriptions.retrieve((event.data.object as Stripe.Subscription).id);
    if (subscription.metadata.app !== "learning_guide") return processLegacyStripeEvent(event);
    return applyVerifiedStripeEvent({ id: event.id, type: event.type, action: "subscription", subscriptionId: subscription.id, status: subscription.status, cancelAtPeriodEnd: subscription.cancel_at_period_end });
  }
  return { ignored: true };
}

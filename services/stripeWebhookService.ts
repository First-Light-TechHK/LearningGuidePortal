import { processLegacyStripeEvent } from "./stripeLegacyWebhookService";
import type Stripe from "stripe";
import { applyVerifiedStripeEvent, isLegacyStripeSubscription, isSnapshotStripeCheckout } from "./productStore";
import { getStripe } from "./stripeClient";
import { reconcileStripeUpgradeInvoice } from "./stripeUpgradePayment";
import { reconcileStripeCheckout } from "./stripeCheckoutPayment";

const identifier = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id;
const iso = (value: number | null | undefined) => value ? new Date(value * 1000).toISOString() : undefined;

export async function processStripeWebhook(rawBody: string, signature: string) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("Webhook unavailable.");
  const stripe = getStripe();
  const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  if (process.env.STRIPE_SANDBOX === "1" && event.livemode) throw new Error("Live events are not allowed in this sandbox.");
  const object = event.data.object as unknown as { metadata?: Record<string, string> };
  if (event.type.startsWith("checkout.session.") && object.metadata?.app !== "learning_guide" && !await isSnapshotStripeCheckout((event.data.object as Stripe.Checkout.Session).id)) return processLegacyStripeEvent(event);
  if (["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired"].includes(event.type)) return reconcileStripeCheckout(event, (event.data.object as Stripe.Checkout.Session).id);
  if (["invoice.paid", "invoice.payment_failed", "invoice.voided"].includes(event.type)) {
    const incoming = event.data.object as Stripe.Invoice;
    const incomingSubscription = identifier(incoming.parent?.subscription_details?.subscription) || identifier((incoming as unknown as { subscription?: string }).subscription);
    if (incomingSubscription && await isLegacyStripeSubscription(incomingSubscription)) return processLegacyStripeEvent(event);
    let invoice: Stripe.Invoice;
    try {
      invoice = await stripe.invoices.retrieve((event.data.object as Stripe.Invoice).id);
    } catch {
      if (event.type === "invoice.payment_failed") return { ignored: true };
      throw new Error("Invoice is not available yet.");
    }
    const upgraded = await reconcileStripeUpgradeInvoice(event, invoice);
    if (upgraded) return upgraded;
    if (event.type === "invoice.voided") return { ignored: true };
    const legacy = invoice as unknown as { subscription?: string | { id: string }; payment_intent?: string | { id: string } };
    const subscriptionId = identifier(invoice.parent?.subscription_details?.subscription) || identifier(legacy.subscription);
    if (!subscriptionId) return { ignored: true };
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    if (subscription.metadata.app !== "learning_guide") return processLegacyStripeEvent(event);
    // An invoice can arrive before Checkout: reconcile the trusted Checkout first.
    const sessions = await stripe.checkout.sessions.list({ subscription: subscriptionId, limit: 1 });
    if (!sessions.data[0]) throw new Error("Checkout not available yet.");
    await reconcileStripeCheckout({ ...event, id: "checkout:" + sessions.data[0].id, type: "checkout.session.completed" }, sessions.data[0].id);
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
  if (["customer.subscription.pending_update_applied", "customer.subscription.pending_update_expired"].includes(event.type)) {
    const subscription = await stripe.subscriptions.retrieve((event.data.object as Stripe.Subscription).id);
    const invoiceId = identifier(subscription.latest_invoice);
    if (!invoiceId) return { ignored: true };
    const invoice = await stripe.invoices.retrieve(invoiceId);
    return await reconcileStripeUpgradeInvoice(event, invoice) || { ignored: true };
  }
  if (["customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
    const subscription = await stripe.subscriptions.retrieve((event.data.object as Stripe.Subscription).id);
    if (subscription.metadata.app !== "learning_guide") return processLegacyStripeEvent(event);
    return applyVerifiedStripeEvent({ id: event.id, type: event.type, action: "subscription", subscriptionId: subscription.id, status: subscription.status, cancelAtPeriodEnd: subscription.cancel_at_period_end });
  }
  return { ignored: true };
}

import type Stripe from "stripe";
import { PaymentError, type StripePriceSnapshot } from "@/contracts/payment";
import type { StripeUpgradeProration } from "@/contracts/stripe-upgrade";
import { getStripe } from "./stripeClient";
import { validateSubscriptionPrice } from "./stripePriceService";

export const stripeIdentity = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id;
export function invoiceSubscription(invoice: Stripe.Invoice) {
  return stripeIdentity(invoice.parent?.subscription_details?.subscription) || stripeIdentity((invoice as Stripe.Invoice & { subscription?: string | { id: string } }).subscription);
}
export function validateUpgradePeriod(subscription: Stripe.Subscription, snapshot: StripeUpgradeProration) {
  const item = subscription.items.data[0];
  if (subscription.id !== snapshot.subscriptionId || stripeIdentity(subscription.customer) !== snapshot.customerId || subscription.items.data.length !== 1
    || item.id !== snapshot.itemId || item.quantity !== 1 || item.current_period_start !== snapshot.periodStart || item.current_period_end !== snapshot.periodEnd
    || subscription.billing_cycle_anchor !== snapshot.billingCycleAnchor) throw new PaymentError("quote_expired");
}

export async function previewStripeUpgrade(input: { subscriptionId: string; customerId: string; sourcePriceId: string; sourceValidTo: string; price: StripePriceSnapshot; prorationDate?: number; verifiedLegacyCheckout?: boolean }) {
  try {
    const stripe = getStripe();
    const target = await stripe.prices.retrieve(input.price.stripePriceId);
    validateSubscriptionPrice(target, input.price.termMonths);
    if (target.unit_amount !== input.price.amountMinor || target.currency !== input.price.currency) throw new PaymentError("quote_expired");
    const subscription = await stripe.subscriptions.retrieve(input.subscriptionId, { expand: ["latest_invoice"] });
    const item = subscription.items.data[0];
    if (stripeIdentity(subscription.customer) === input.customerId && subscription.pending_update) throw new PaymentError("upgrade_in_progress");
    const latest = typeof subscription.latest_invoice === "string" ? await stripe.invoices.retrieve(subscription.latest_invoice) : subscription.latest_invoice;
    if (stripeIdentity(subscription.customer) !== input.customerId || subscription.status !== "active" || subscription.cancel_at_period_end || subscription.pause_collection || subscription.schedule
      || subscription.collection_method !== "charge_automatically" || subscription.items.data.length !== 1 || !item || item.quantity !== 1
      || item.price.id !== input.sourcePriceId || item.price.currency !== target.currency || item.price.recurring?.interval !== target.recurring?.interval
      || item.price.recurring?.interval_count !== target.recurring?.interval_count || latest?.status !== "paid"
      || !input.verifiedLegacyCheckout && Math.floor(Date.parse(input.sourceValidTo) / 1000) !== item.current_period_end) throw new PaymentError("upgrade_unavailable");
    const prorationDate = input.prorationDate ?? Math.floor(Date.now() / 1000);
    if (prorationDate < item.current_period_start || prorationDate >= item.current_period_end) throw new PaymentError("quote_expired");
    const invoice = await stripe.invoices.createPreview({ customer: input.customerId, subscription: subscription.id,
      subscription_details: { items: [{ id: item.id, price: target.id, quantity: 1 }], billing_cycle_anchor: "unchanged", proration_behavior: "always_invoice", proration_date: prorationDate } });
    if (invoice.currency !== target.currency || invoice.lines.has_more || !Number.isSafeInteger(invoice.amount_due) || invoice.amount_due < 0 || !Number.isSafeInteger(invoice.total)) throw new PaymentError("price_unavailable", 503);
    const lines = invoice.lines.data;
    if (!lines.length || lines.some(line => !line.parent?.subscription_item_details?.proration)) throw new PaymentError("price_unavailable", 503);
    const debitMinor = lines.reduce((sum, line) => sum + Math.max(0, line.amount), 0);
    const creditMinor = lines.reduce((sum, line) => sum + Math.max(0, -line.amount), 0);
    const result: StripeUpgradeProration = { subscriptionId: subscription.id, customerId: input.customerId, itemId: item.id, sourcePriceId: item.price.id,
      prorationDate, periodStart: item.current_period_start, periodEnd: item.current_period_end, billingCycleAnchor: subscription.billing_cycle_anchor,
      debitMinor, creditMinor, adjustmentsMinor: invoice.amount_due - (debitMinor - creditMinor), invoiceTotalMinor: invoice.total, amountDueMinor: invoice.amount_due };
    if (input.verifiedLegacyCheckout) result.sourceRecordedValidTo = input.sourceValidTo;
    return result;
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError("price_unavailable", 503);
  }
}

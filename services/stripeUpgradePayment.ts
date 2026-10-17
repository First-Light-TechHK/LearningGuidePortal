import type Stripe from "stripe";
import { PaymentError } from "@/contracts/payment";
import type { StripeUpgradeProration } from "@/contracts/stripe-upgrade";
import { getStripe } from "./stripeClient";
import { applyVerifiedStripeEvent, assertStripeUpgradeAllowed, attachStripeUpgradeInvoice, createPendingStripeUpgradeOrderFromQuote,
  getQuoteForUser, prepareStripeCheckout, stripeUpgradeInvoiceContext } from "./productStore";
import { invoiceSubscription, previewStripeUpgrade, stripeIdentity, validateUpgradePeriod } from "./stripeUpgradeProration";

function validateInvoice(invoice: Stripe.Invoice, snapshot: StripeUpgradeProration) {
  if (invoiceSubscription(invoice) !== snapshot.subscriptionId || stripeIdentity(invoice.customer) !== snapshot.customerId || invoice.billing_reason !== "subscription_update"
    || invoice.currency !== "usd" || invoice.amount_due !== snapshot.amountDueMinor || invoice.total !== snapshot.invoiceTotalMinor || invoice.lines.has_more
    || !invoice.lines.data.some(line => line.parent?.subscription_item_details?.proration)
    || invoice.lines.data.reduce((sum, line) => sum + Math.max(0, line.amount), 0) !== snapshot.debitMinor
    || invoice.lines.data.reduce((sum, line) => sum + Math.max(0, -line.amount), 0) !== snapshot.creditMinor
    || invoice.lines.data.some(line => !line.parent?.subscription_item_details?.proration || line.parent.subscription_item_details.subscription_item !== snapshot.itemId
      || line.period.start !== snapshot.prorationDate || line.period.end !== snapshot.periodEnd)) throw new Error("Upgrade invoice mismatch.");
}

export async function reconcileStripeUpgradeInvoice(event: { id: string; type: string }, invoice: Stripe.Invoice) {
  const subscriptionId = invoiceSubscription(invoice);
  if (!subscriptionId || invoice.billing_reason !== "subscription_update") return null;
  const order = await stripeUpgradeInvoiceContext(invoice.id, subscriptionId, invoice.created);
  if (!order?.upgradeProration || !order.price) return null;
  const snapshot = order.upgradeProration;
  validateInvoice(invoice, snapshot);
  // A paid invoice may be replayed after a later renewal has advanced the
  // subscription period. Its recorded order must stay idempotent then too.
  if (order.status === "paid" && invoice.status === "paid") return applyVerifiedStripeEvent({ id: event.id, type: event.type, action: "upgrade_invoice", orderId: order.id,
    invoiceId: invoice.id, subscriptionId, customerId: snapshot.customerId, currency: invoice.currency, amountMinor: invoice.amount_due, status: "paid",
    periodStart: new Date(snapshot.periodStart * 1000).toISOString(), periodEnd: new Date(snapshot.periodEnd * 1000).toISOString() });
  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  if (stripeIdentity(subscription.customer) !== snapshot.customerId) throw new Error("Upgrade subscription mismatch.");
  if (invoice.status === "paid") validateUpgradePeriod(subscription, snapshot);
  const currentPrice = subscription.items.data[0].price.id;
  if (invoice.status === "paid" && (subscription.pending_update || subscription.status !== "active" || currentPrice !== order.price.stripePriceId || invoice.amount_paid !== snapshot.amountDueMinor)) throw new Error("Upgrade subscription is not applied yet.");
  if (invoice.status === "paid") await assertStripeUpgradeAllowed(order.id);
  const paymentIntentId = invoice.status === "paid" ? (await getStripe().invoicePayments.list({ invoice: invoice.id, status: "paid", limit: 10 })).data
    .map(payment => stripeIdentity(payment.payment.payment_intent)).find(Boolean) : undefined;
  return applyVerifiedStripeEvent({ id: event.id, type: event.type, action: "upgrade_invoice", orderId: order.id,
    invoiceId: invoice.id, subscriptionId, customerId: snapshot.customerId, currency: invoice.currency, amountMinor: invoice.amount_due,
    status: invoice.status || undefined, subscriptionStatus: subscription.status, cancelAtPeriodEnd: subscription.cancel_at_period_end, paymentIntentId,
    periodStart: new Date(snapshot.periodStart * 1000).toISOString(), periodEnd: new Date(snapshot.periodEnd * 1000).toISOString() });
}

export async function startStripeUpgradePayment(userId: string, quoted: NonNullable<Awaited<ReturnType<typeof getQuoteForUser>>>, origin: string, locale: "en-GB" | "zh-CN") {
  const snapshot = quoted.quote.upgradeProration, price = quoted.quote.price, source = quoted.sourceSubscription;
  if (!snapshot || !price || !source || snapshot.subscriptionId !== source.stripeSubscriptionId || snapshot.customerId !== source.stripeCustomerId) throw new PaymentError("quote_expired");
  if (snapshot.sourceRecordedValidTo !== undefined && snapshot.sourceRecordedValidTo !== source.validTo) throw new PaymentError("quote_expired");
  const stripe = getStripe();
  const returnUrl = (orderId: string) => `/${locale}/account/my-learning/subscription?orderId=${encodeURIComponent(orderId)}`;
  if (quoted.upgradeOrder?.status === "paid") return { order: quoted.upgradeOrder, checkoutUrl: returnUrl(quoted.upgradeOrder.id) };
  // A lost response is recovered from the existing subscription's invoice before
  // retrying the same idempotent update. Never create a second proration invoice.
  let invoice: Stripe.Invoice | null = null;
  const existing = quoted.upgradeOrder;
  if (existing) {
    if (existing.status !== "pending") throw new PaymentError("quote_expired");
    if (existing.stripeInvoiceId) invoice = await stripe.invoices.retrieve(existing.stripeInvoiceId);
    else {
      const remote = await stripe.subscriptions.retrieve(snapshot.subscriptionId, { expand: ["latest_invoice"] });
      const latest = typeof remote.latest_invoice === "string" ? await stripe.invoices.retrieve(remote.latest_invoice) : remote.latest_invoice;
      if (latest?.billing_reason === "subscription_update" && latest.created >= Math.floor(Date.parse(existing.createdAt) / 1000)) invoice = latest;
    }
  }
  if (!invoice) {
    if (Date.parse(quoted.quote.expiresAt) <= Date.now()) throw new PaymentError("quote_expired");
    const preview = await previewStripeUpgrade({ subscriptionId: snapshot.subscriptionId, customerId: snapshot.customerId, sourcePriceId: snapshot.sourcePriceId,
      sourceValidTo: source.validTo, price, prorationDate: snapshot.prorationDate, verifiedLegacyCheckout: snapshot.sourceRecordedValidTo !== undefined });
    if (JSON.stringify(preview) !== JSON.stringify(snapshot)) throw new PaymentError("quote_expired");
  }
  const pending = await createPendingStripeUpgradeOrderFromQuote(userId, quoted.quote.id);
  const order = await prepareStripeCheckout(userId, pending.order.id, origin, locale);
  if (order.status === "paid") return { order, checkoutUrl: returnUrl(order.id) };
  if (!invoice) {
    const remote = await stripe.subscriptions.update(snapshot.subscriptionId, { items: [{ id: snapshot.itemId, price: price.stripePriceId, quantity: 1 }],
      billing_cycle_anchor: "unchanged", proration_date: snapshot.prorationDate, proration_behavior: "always_invoice", payment_behavior: "pending_if_incomplete", expand: ["latest_invoice"] },
    { idempotencyKey: "learning-guide-prorated-upgrade-" + order.id });
    invoice = typeof remote.latest_invoice === "string" ? await stripe.invoices.retrieve(remote.latest_invoice) : remote.latest_invoice;
    if (!invoice) throw new PaymentError("payment_unavailable", 503);
  }
  validateInvoice(invoice, snapshot);
  const attached = await attachStripeUpgradeInvoice(userId, order.id, invoice.id);
  await reconcileStripeUpgradeInvoice({ id: `upgrade-invoice:${invoice.id}:${invoice.status}`, type: "upgrade.invoice.retrieved" }, invoice);
  if (invoice.status === "paid") return { order: { ...attached, status: "paid" as const }, checkoutUrl: returnUrl(order.id) };
  if (invoice.status !== "open" || !invoice.hosted_invoice_url) throw new PaymentError("quote_expired");
  return { order: attached, checkoutUrl: invoice.hosted_invoice_url };
}

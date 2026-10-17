import { loadEnvConfig } from "@next/env";
import { isDeepStrictEqual } from "node:util";
import { subscriptionPrices } from "../contracts/payment";
import { getStripe } from "../services/stripeClient";
import { resolveSubscriptionPrice } from "../services/stripePriceService";
import { resolveLegacyUpgradeSourcePrice } from "../services/stripeUpgradeSource";
import { previewStripeUpgrade, stripeIdentity } from "../services/stripeUpgradeProration";

// Read-only real-provider acceptance. Never updates an existing subscription.
loadEnvConfig(process.cwd());
async function main() {
  if (process.env.STRIPE_SANDBOX !== "1" || !process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("Sandbox test key required.");
  const createdAt = Number(process.argv.find(value => value.startsWith("--created-at="))?.split("=")[1]);
  if (!Number.isSafeInteger(createdAt) || createdAt < 1) throw new Error("Pass --created-at=<local subscription creation time in milliseconds>.");
  const stripe = getStripe(), center = Math.floor(createdAt / 1000);
  const matches = await stripe.subscriptions.list({ status: "all", created: { gte: center - 300, lte: center + 30 }, limit: 100 });
  if (matches.has_more || matches.data.length !== 1) throw new Error("The source time window must identify exactly one Stripe subscription.");
  const source = matches.data[0], item = source.items.data[0];
  const mapping = subscriptionPrices.find(plan => plan.id === source.metadata.planId && plan.scope === "category");
  if (!mapping || !item || source.items.data.length !== 1 || source.livemode) throw new Error("Expected one test Category subscription item.");
  const sessions = await stripe.checkout.sessions.list({ subscription: source.id, limit: 2 });
  if (sessions.has_more || sessions.data.length !== 1) throw new Error("Expected one original subscription Checkout.");
  const checkout = sessions.data[0], meta = checkout.metadata;
  if (!meta?.orderId || !meta.userId || meta.planId !== mapping.id || meta.userId !== source.metadata.userId || meta.orderId !== source.metadata.orderId
    || checkout.amount_total == null || !checkout.currency) throw new Error("Original Checkout ownership evidence is incomplete.");
  const sourcePriceId = await resolveLegacyUpgradeSourcePrice({ checkoutSessionId: checkout.id, orderId: meta.orderId, userId: meta.userId,
    planId: mapping.id, subscriptionId: source.id, customerId: stripeIdentity(source.customer)!, amountMinor: checkout.amount_total, currency: checkout.currency });
  const price = await resolveSubscriptionPrice(`everything-pc-${mapping.termMonths}`);
  // Exercise legacy callback-time drift while keeping Stripe's actual bounds.
  const preview = await previewStripeUpgrade({ subscriptionId: source.id, customerId: stripeIdentity(source.customer)!, sourcePriceId,
    sourceValidTo: new Date((item.current_period_end + 4) * 1000).toISOString(), price, verifiedLegacyCheckout: true });
  const persisted = Object.fromEntries(Object.entries(preview).sort(([a], [b]) => a.length - b.length || a.localeCompare(b)));
  const repeated = await previewStripeUpgrade({ subscriptionId: source.id, customerId: stripeIdentity(source.customer)!, sourcePriceId,
    sourceValidTo: new Date((item.current_period_end + 4) * 1000).toISOString(), price, verifiedLegacyCheckout: true, prorationDate: preview.prorationDate });
  if (!isDeepStrictEqual(repeated, persisted)) throw new Error("Pinned Stripe re-preview differs from the persisted quote values.");
  const after = await stripe.subscriptions.retrieve(source.id);
  if (after.items.data[0].price.id !== item.price.id || after.items.data[0].current_period_end !== item.current_period_end || after.billing_cycle_anchor !== source.billing_cycle_anchor) throw new Error("Read-only preview unexpectedly changed the subscription.");
  console.log(JSON.stringify({ ok: true, sandbox: true, sourceCategory: mapping.scopeId, termMonths: mapping.termMonths, legacyAppMarkerAbsent: !meta.app,
    amountDueMinor: preview.amountDueMinor, currency: price.currency, debitMinor: preview.debitMinor, creditMinor: preview.creditMinor, adjustmentsMinor: preview.adjustmentsMinor,
    repreviewMatchesPersistedQuote: true, originalPeriodRetained: true, charged: false }));
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  console.log(JSON.stringify({ webhookChecks: endpoints.data.filter(endpoint => new URL(endpoint.url).hostname.endsWith("ilovelearningguide.com")).map(endpoint => ({
    url: endpoint.url, status: endpoint.status, missingEvents: endpoint.enabled_events.includes("*") ? [] : ["invoice.paid", "invoice.payment_failed", "invoice.voided", "customer.subscription.updated", "customer.subscription.deleted"].filter(event => !endpoint.enabled_events.includes(event as typeof endpoint.enabled_events[number])),
  })) }));
}
main().catch(error => {
  console.error(JSON.stringify({ ok: false, type: error.type || error.name, code: error.code || "verification_failed" }));
  process.exitCode = 1;
});

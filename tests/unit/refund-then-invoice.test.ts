// ORDER-02 service lock: "Operator refund then later invoice.paid must not
// revive" (suites/order/cases.md). The renewal below is the live delivery
// shape: billing_reason subscription_cycle for the SAME Stripe subscription
// the refunded checkout came from, with a period extending beyond the
// refunded one. The store deliberately keeps recording the renewal invoice as
// a paid order (the money fact); only the ACCESS revival must be blocked.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const COURSE_ID = "epicureanism";
const PLAN_ID = "epicureanism-pc-6";
const STRIPE_SUBSCRIPTION_ID = "sub_order02_refund";
const CHECKOUT_PERIOD_START = "2026-10-11T02:00:00.000Z";
const CHECKOUT_PERIOD_END = "2027-04-11T02:00:00.000Z";
// The renewal period extends ~1 month beyond the checked-out period, so
// "the invoice cannot move the paid period backwards" is NOT the reason
// access must stay off.
const RENEWAL_PERIOD_END = "2027-05-11T02:00:00.000Z";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-refund-then-invoice-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  store = await import("../../services/productStore");
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) {
    await rm(isolatedCwd, { recursive: true, force: true });
  }
});

test("ORDER-02: a refunded purchase stays revoked when a later renewal invoice.paid arrives", async () => {
  const user = await store.registerUser({ email: "order02-refund-revive@example.test", password: "password1" });

  // Pending Stripe checkout order, then the verified checkout event completes
  // it — the same seeding the spike used to verify the defect and the same
  // shape the PostgreSQL proof seeds.
  const pending = await store.createPendingStripeTrialOrder(user.id, PLAN_ID);
  await store.attachStripeCheckoutSession(user.id, pending.order.id, "cs_order02_refund");
  const checkout = await store.applyVerifiedStripeEvent({
    id: "evt_order02_checkout",
    type: "checkout.session.completed",
    action: "checkout",
    orderId: pending.order.id,
    sessionId: "cs_order02_refund",
    subscriptionId: STRIPE_SUBSCRIPTION_ID,
    customerId: "cus_order02",
    paymentIntentId: "pi_order02",
    trial: false,
    subscriptionStatus: "active",
    cancelAtPeriodEnd: false,
    periodStart: CHECKOUT_PERIOD_START,
    periodEnd: CHECKOUT_PERIOD_END
  });
  assert.equal(checkout.duplicate, false, "the checkout event must apply");

  const granted = await store.ensureProductData();
  const subscription = granted.subscriptions.find((item) => item.stripeSubscriptionId === STRIPE_SUBSCRIPTION_ID);
  assert.ok(subscription, "the checkout must create the purchase subscription");
  assert.equal(subscription.source, "purchase");
  const entitlement = granted.entitlements.find((item) => item.userId === user.id && item.source === "purchase" && item.state === "active");
  assert.ok(entitlement, "the checkout must grant an active purchase entitlement");
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, true, "a paid purchase grants the course");

  // Operator refund: money goes back, access goes away.
  const refunded = await store.refundOrder(pending.order.id, "operator-order02", null, "ORDER-02 refund then renewal invoice");
  assert.equal(refunded.status, "refunded");
  const afterRefund = await store.ensureProductData();
  assert.equal(afterRefund.subscriptions.find((item) => item.id === subscription.id)?.state, "expired", "the refund must expire the subscription");
  assert.equal(afterRefund.entitlements.find((item) => item.id === entitlement.id)?.state, "revoked", "the refund must revoke the entitlement");
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, false, "the refund must remove course access");

  // A LATER renewal invoice.paid for the same Stripe subscription, new invoice id.
  const renewal = await store.applyVerifiedStripeEvent({
    id: "evt_order02_renewal_invoice",
    type: "invoice.paid",
    action: "invoice",
    subscriptionId: STRIPE_SUBSCRIPTION_ID,
    invoiceId: "in_order02_renewal",
    amountMinor: 4900,
    currency: "usd",
    status: "paid",
    billingReason: "subscription_cycle",
    subscriptionStatus: "active",
    cancelAtPeriodEnd: false,
    paymentIntentId: "pi_order02_renewal",
    periodStart: CHECKOUT_PERIOD_END,
    periodEnd: RENEWAL_PERIOD_END
  });
  assert.equal(renewal.duplicate, false, "the renewal invoice must be processed, not deduplicated");

  // The ORDER-02 contract: the refund wins; the invoice must not revive access.
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, false, "ORDER-02: the renewal invoice must not revive the refunded purchase");
  const finalData = await store.ensureProductData();
  assert.equal(finalData.subscriptions.find((item) => item.id === subscription.id)?.state, "expired", "the subscription must stay non-active after the renewal invoice");
  assert.equal(finalData.entitlements.find((item) => item.id === entitlement.id)?.state, "revoked", "the revoked entitlement must not flip back to active");
  assert.equal(finalData.entitlements.filter((item) => item.userId === user.id && item.state === "active").length, 0, "no active entitlement may exist after the refund");

  // The money fact is still recorded: the renewal invoice becomes one paid order.
  const renewalOrders = finalData.orders.filter((item) => item.stripeInvoiceId === "in_order02_renewal");
  assert.equal(renewalOrders.length, 1, "the renewal invoice is recorded exactly once");
  assert.equal(renewalOrders[0].status, "paid", "the renewal order keeps the paid money fact");
  assert.equal(renewalOrders[0].kind, "purchase");
  assert.equal(renewalOrders[0].amountMinor, 4900);
});

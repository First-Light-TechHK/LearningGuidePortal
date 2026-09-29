import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "path";
import { activateThreeDayTrial, purchaseCourse, readProductData, verifiedUser, writeProductData } from "./helpers/my-learning";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-refund-invoice-"));
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

test("PAY-04: refunded access stays revoked after a later invoice.paid", async () => {
  const user = await verifiedUser(store, "refund-invoice@example.test");
  await purchaseCourse(store, user.id);
  const paid = (await store.getLearningOverview(user.id)).orders.find((order) => order.status === "paid" && order.kind !== "trial_activation");
  assert.ok(paid);
  assert.equal((await store.checkEntitlement(user.id, "epicureanism")).allowed, true);

  const data = await readProductData();
  const stripeSubscriptionId = "sub_refund_then_invoice";
  const order = data.orders.find((item: { id: string }) => item.id === paid.id);
  const subscription = data.subscriptions.find((item: { userId: string; source: string }) => item.userId === user.id && item.source === "purchase");
  assert.ok(order);
  assert.ok(subscription);
  order.stripeSubscriptionId = stripeSubscriptionId;
  subscription.stripeSubscriptionId = stripeSubscriptionId;
  await writeProductData(data);

  await store.refundDemoOrder(paid.id);
  assert.equal((await store.checkEntitlement(user.id, "epicureanism")).allowed, false);
  const refunded = await readProductData();
  assert.equal(refunded.entitlements.find((item: { userId: string; source: string }) => item.userId === user.id && item.source === "purchase")?.state, "revoked");

  const laterEnd = new Date(Date.now() + 180 * 86_400_000).toISOString();
  await store.applyVerifiedStripeEvent({
    id: "evt_refund_then_invoice",
    type: "invoice.paid",
    action: "invoice",
    subscriptionId: stripeSubscriptionId,
    invoiceId: "in_after_refund",
    amountMinor: paid.amountMinor,
    currency: "usd",
    status: "paid",
    billingReason: "subscription_cycle",
    subscriptionStatus: "active",
    periodStart: new Date().toISOString(),
    periodEnd: laterEnd,
  });

  assert.equal((await store.checkEntitlement(user.id, "epicureanism")).allowed, false);
  const after = await readProductData();
  assert.equal(after.orders.filter((item: { status: string }) => item.status === "paid").length, 0);
  assert.ok(after.orders.every((item: { stripeInvoiceId?: string }) => item.stripeInvoiceId !== "in_after_refund"));
  assert.equal(after.entitlements.find((item: { userId: string; source: string }) => item.userId === user.id && item.source === "purchase")?.state, "revoked");
  assert.equal(after.subscriptions.find((item: { stripeSubscriptionId?: string }) => item.stripeSubscriptionId === stripeSubscriptionId)?.state, "expired");
});

test("trial resume restores the original window and complete after cancel still fails", async () => {
  const user = await verifiedUser(store, "trial-restore@example.test");
  await activateThreeDayTrial(store, user.id);
  const before = (await store.getLearningOverview(user.id)).subscriptions.find((item) => item.source === "trial");
  assert.ok(before);
  const originalValidTo = before.validTo;
  const canceled = await store.cancelSubscription(user.id, before.id);
  assert.equal(canceled.state, "trial_canceled");
  assert.equal(canceled.validTo, originalValidTo);
  assert.equal((await store.checkEntitlement(user.id, "epicureanism")).allowed, false);

  const pending = (await store.getLearningOverview(user.id)).orders.find((order) => order.kind === "trial_activation");
  assert.ok(pending);
  await assert.rejects(() => store.completeDemoTrialOrder(user.id, pending.id), /cannot be completed/);

  const resumed = await store.resumeSubscription(user.id, before.id);
  assert.equal(resumed.state, "active");
  assert.equal(resumed.validTo, originalValidTo);
  assert.equal((await store.checkEntitlement(user.id, "epicureanism")).allowed, true);
  assert.equal((await store.checkEntitlement(user.id, "epicureanism")).validTo, originalValidTo);
});

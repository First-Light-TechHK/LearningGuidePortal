import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { purchaseCourse, verifiedUser } from "./helpers/my-learning";

// Break: ML-FR-011 five access bands come from Subscription / Entitlement,
// not from the Overview inventing a sixth state. Cancel stays in-app
// (no Stripe Portal URL). Resume-after-paid-cancel is out of scope.

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-ml-fr-011-"));
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

test("ML-FR-011: no subscription is accessState none", async () => {
  const user = await verifiedUser(store, "ml-fr-011-none@example.test");
  const overview = await store.getLearningOverview(user.id);
  assert.equal(overview.accessState, "none");
});

test("ML-FR-011: paid purchase is accessState active", async () => {
  const user = await verifiedUser(store, "ml-fr-011-active@example.test");
  await purchaseCourse(store, user.id);
  const overview = await store.getLearningOverview(user.id);
  assert.equal(overview.accessState, "active");
});

test("ML-FR-011: cancel auto-renew is cancel_at_period_end and does not return a Stripe portal URL", async () => {
  const user = await verifiedUser(store, "ml-fr-011-cancel@example.test");
  await purchaseCourse(store, user.id);
  const overview = await store.getLearningOverview(user.id);
  const subscription = overview.subscriptions.find((item) => item.source === "purchase");
  assert.ok(subscription);
  const canceled = await store.cancelSubscription(user.id, subscription.id, { code: "too_expensive" });
  assert.equal(canceled.state, "cancel_at_period_end");
  assert.equal("portalUrl" in canceled, false);
  assert.equal("checkoutUrl" in canceled, false);

  const after = await store.getLearningOverview(user.id);
  assert.equal(after.accessState, "cancel_at_period_end");
});

test("ML-FR-011: refunded access is accessState expired", async () => {
  const user = await verifiedUser(store, "ml-fr-011-expired@example.test");
  await purchaseCourse(store, user.id);
  const orders = (await store.getLearningOverview(user.id)).orders;
  const paid = orders.find((order) => order.status === "paid" && order.kind !== "trial_activation");
  assert.ok(paid);
  await store.refundDemoOrder(paid.id);

  const overview = await store.getLearningOverview(user.id);
  assert.equal(overview.accessState, "expired");
});

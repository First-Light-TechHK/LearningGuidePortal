import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  COURSE_ID,
  PLAN_ID,
  PRIVATE_LP,
  activateThreeDayTrial,
  purchaseCourse,
  readProductData,
  verifiedUser,
  writeProductData
} from "./helpers/my-learning";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-trial-boundary-"));
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

async function setTrialValidTo(userId: string, validTo: string) {
  const data = await readProductData();
  let touched = 0;
  for (const entitlement of data.entitlements) {
    if (entitlement.userId === userId && entitlement.source === "trial") {
      entitlement.validTo = validTo;
      entitlement.state = "active";
      touched += 1;
    }
  }
  for (const subscription of data.subscriptions) {
    if (subscription.userId === userId && subscription.source === "trial") {
      subscription.validTo = validTo;
      subscription.state = "active";
    }
  }
  assert.ok(touched > 0, "expected a trial entitlement row to move");
  await writeProductData(data);
}

test("trial entitlement is allowed 5s before validTo and denied at and after validTo", async () => {
  const user = await verifiedUser(store, "trial-boundary@example.test");
  await activateThreeDayTrial(store, user.id);

  const before = new Date(Date.now() + 5000).toISOString();
  await setTrialValidTo(user.id, before);
  const live = await store.checkEntitlement(user.id, COURSE_ID);
  assert.equal(live.allowed, true);
  assert.equal(live.source, "trial");

  const exact = new Date().toISOString();
  await setTrialValidTo(user.id, exact);
  const atBoundary = await store.checkEntitlement(user.id, COURSE_ID);
  assert.equal(atBoundary.allowed, false, "validTo <= now must not grant (inclusive expiry)");

  const past = new Date(Date.now() - 1).toISOString();
  await setTrialValidTo(user.id, past);
  const after = await store.checkEntitlement(user.id, COURSE_ID);
  assert.equal(after.allowed, false);
  assert.equal(after.source, null);
});

test("an expired trial shows the conversion CTA and relocks private lessons", async () => {
  const user = await verifiedUser(store, "trial-cta@example.test");
  await activateThreeDayTrial(store, user.id);
  await setTrialValidTo(user.id, new Date(Date.now() - 1).toISOString());

  const page = await store.getCoursePage(COURSE_ID, user.id);
  assert.equal(page.cta, "view_plans");
  assert.notEqual(page.cta, "continue_learning");
  assert.equal(page.syllabus.find((item) => item.lessonId === PRIVATE_LP)?.access, "locked");
  assert.equal(page.syllabus.find((item) => item.lessonId === PRIVATE_LP)?.openable, false);
});

test("a second demo trial for the same plan reuses the paid order and does not extend validTo", async () => {
  const user = await verifiedUser(store, "trial-twice@example.test");
  const pending = await store.createPendingDemoTrialOrder(user.id, PLAN_ID);
  await store.completeDemoTrialOrder(user.id, pending.order.id);
  const before = await store.checkEntitlement(user.id, COURSE_ID);
  assert.equal(before.allowed, true);
  const originalValidTo = before.validTo;
  assert.ok(originalValidTo);

  const again = await store.createPendingDemoTrialOrder(user.id, PLAN_ID);
  assert.equal(again.order.id, pending.order.id);
  assert.equal(again.order.status, "paid");
  const after = await store.checkEntitlement(user.id, COURSE_ID);
  assert.equal(after.allowed, true);
  assert.equal(after.source, "trial");
  assert.equal(after.validTo, originalValidTo);
});

test("a converted purchase cannot start another trial on the same plan", async () => {
  const user = await verifiedUser(store, "trial-after-pay@example.test");
  await purchaseCourse(store, user.id);
  await assert.rejects(
    store.createPendingDemoTrialOrder(user.id, PLAN_ID),
    /already has active access|already been used/i
  );
  const access = await store.checkEntitlement(user.id, COURSE_ID);
  assert.equal(access.allowed, true);
  assert.equal(access.source, "purchase");
});

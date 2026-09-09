import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  COURSE_ID,
  PREVIEW_LP,
  PRIVATE_LP,
  activateThreeDayTrial,
  openLearningPoint,
  purchaseCourse,
  verifiedUser,
} from "./helpers/my-learning";

// Break: Overview cards follow ML-FR-004/006 five-state / trial+started.
// Purchased-never-started stays off the list (aligned with LEARN-02 / E2E-B1-007).
// No-sub users who entered the private-course preview range DO get a card
// (ML-FR-004). That conflicts with the LEARN-02 "preview must not mint a card"
// handbook lock — this file follows the PRD and records the conflict.

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-ml-fr-004-"));
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

test("LEARN-02 / ML-FR-006: purchased with no opened LP does not invent a course card", async () => {
  const user = await verifiedUser(store, "ml-fr-006-purchased-empty@example.test");
  await purchaseCourse(store, user.id);

  const overview = await store.getLearningOverview(user.id);
  assert.ok(overview.entitlements.length >= 1);
  assert.equal(overview.courses.length, 0);
  assert.equal(overview.emptyState, "no_started");
  assert.equal(overview.emptyCta, "browse_courses");
});

test("ML-FR-004: no-sub user who opened the private-course preview range gets a card", async () => {
  const user = await verifiedUser(store, "ml-fr-004-preview-card@example.test");
  await openLearningPoint(store, user.id, PREVIEW_LP, "preview-enter", "preview");

  const overview = await store.getLearningOverview(user.id);
  assert.equal(overview.entitlements.length, 0);
  const card = overview.courses.find((item) => item.courseId === COURSE_ID);
  assert.ok(card, "entered preview range must list the private course");
  assert.equal(card.cardState, "previewing");
  assert.equal(card.cta, "continue_preview");
  assert.equal(card.progress, 50);
});

test("ML-FR-005: completing the configured preview range switches the card to View plans", async () => {
  const user = await verifiedUser(store, "ml-fr-005-preview-limit@example.test");
  await store.recordStudyEvent({
    userId: user.id,
    courseId: COURSE_ID,
    lessonId: PREVIEW_LP,
    event: "complete",
    seconds: 0,
    clientEventId: "preview-complete-limit",
  }, "preview");

  const overview = await store.getLearningOverview(user.id);
  const card = overview.courses.find((item) => item.courseId === COURSE_ID);
  assert.equal(card?.cardState, "preview_limit");
  assert.equal(card?.cta, "view_plans");
  assert.equal(card?.progress, 50);
});

test("ML-FR-004: browsing a course without opening a Learning Point does not list it", async () => {
  const user = await verifiedUser(store, "ml-fr-004-browse-only@example.test");

  const overview = await store.getLearningOverview(user.id);
  assert.equal(overview.courses.length, 0);
  assert.equal(overview.emptyState, "no_preview");
  assert.equal(overview.emptyCta, "browse_courses");
});

test("ML-FR-006: subscribed user who opened a Learning Point is Continue learning", async () => {
  const user = await verifiedUser(store, "ml-fr-006-learning@example.test");
  await purchaseCourse(store, user.id);
  await openLearningPoint(store, user.id, PRIVATE_LP, "paid-start");

  const overview = await store.getLearningOverview(user.id);
  const card = overview.courses.find((item) => item.courseId === COURSE_ID);
  assert.equal(card?.cardState, "learning");
  assert.equal(card?.cta, "continue_learning");
  assert.equal(card?.progress, 50);
});

test("ML-FR-006: cancel-at-period-end still lists a started course as subscribed learning", async () => {
  const user = await verifiedUser(store, "ml-fr-006-cancel-keep@example.test");
  await purchaseCourse(store, user.id);
  await openLearningPoint(store, user.id, PREVIEW_LP, "before-cancel");
  const overviewBefore = await store.getLearningOverview(user.id);
  const subscription = overviewBefore.subscriptions.find((item) => item.source === "purchase");
  assert.ok(subscription);
  const canceled = await store.cancelSubscription(user.id, subscription.id, { code: "too_expensive" });
  assert.equal(canceled.state, "cancel_at_period_end");
  assert.equal("portalUrl" in canceled, false);

  const overview = await store.getLearningOverview(user.id);
  const card = overview.courses.find((item) => item.courseId === COURSE_ID);
  assert.equal(overview.accessState, "cancel_at_period_end");
  assert.equal(card?.cardState, "learning");
  assert.equal(card?.cta, "continue_learning");
});

test("ML-FR-006: expired / refunded history is View plans, not Continue learning", async () => {
  const user = await verifiedUser(store, "ml-fr-006-expired@example.test");
  await purchaseCourse(store, user.id);
  await openLearningPoint(store, user.id, PREVIEW_LP, "before-refund");
  const orders = (await store.getLearningOverview(user.id)).orders;
  const paid = orders.find((order) => order.status === "paid" && order.kind !== "trial_activation");
  assert.ok(paid);
  await store.refundDemoOrder(paid.id);

  const overview = await store.getLearningOverview(user.id);
  const card = overview.courses.find((item) => item.courseId === COURSE_ID);
  assert.ok(card, "historical started course remains after access ends");
  assert.equal(overview.accessState, "expired");
  assert.equal(card.cardState, "no_access_history");
  assert.equal(card.cta, "view_plans");
  assert.notEqual(card.cardState, "learning");
});

test("three trial stories stay distinct: 3-day $0 trial is subscribed learning, not preview minutes", async () => {
  const user = await verifiedUser(store, "ml-fr-006-three-day-trial@example.test");
  await activateThreeDayTrial(store, user.id);
  await openLearningPoint(store, user.id, PRIVATE_LP, "trial-paid-lp");

  const overview = await store.getLearningOverview(user.id);
  assert.ok(overview.entitlements.some((item) => item.source === "trial"));
  const card = overview.courses.find((item) => item.courseId === COURSE_ID);
  assert.equal(card?.cardState, "learning");
  assert.equal(card?.cta, "continue_learning");
  assert.notEqual(card?.cardState, "previewing");
  assert.notEqual(card?.cardState, "preview_limit");
});

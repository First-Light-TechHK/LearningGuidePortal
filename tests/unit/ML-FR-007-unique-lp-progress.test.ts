import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  COURSE_ID,
  PREVIEW_LP,
  PRIVATE_LP,
  openLearningPoint,
  purchaseCourse,
  verifiedUser,
} from "./helpers/my-learning";

// Break: Overview progress must be unique opened Learning Points / total LPs
// (ML-FR-007…010). Seconds, complete-duration, and +300s inject must not be
// the source of truth. Lesson id is the LP; text and video share it.

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-ml-fr-007-"));
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

test("ML-FR-008: opening a Learning Point counts immediately at 50% for a 2-LP course", async () => {
  const user = await verifiedUser(store, "ml-fr-007-open@example.test");
  await purchaseCourse(store, user.id);
  await openLearningPoint(store, user.id, PREVIEW_LP, "open-first-lp");

  const overview = await store.getLearningOverview(user.id);
  const card = overview.courses.find((item) => item.courseId === COURSE_ID);
  assert.ok(card, "started course is on Overview");
  assert.equal(card.openedLearningPointCount, 1);
  assert.equal(card.totalLearningPoints, 2);
  assert.equal(card.progress, 50);
  assert.equal(card.progressFailed, false);
  assert.notEqual(card.progress, 0);
});

test("ML-FR-008: repeating the same Learning Point does not increase progress", async () => {
  const user = await verifiedUser(store, "ml-fr-007-repeat@example.test");
  await purchaseCourse(store, user.id);
  await openLearningPoint(store, user.id, PREVIEW_LP, "open-repeat-1");
  await openLearningPoint(store, user.id, PREVIEW_LP, "open-repeat-2");
  await openLearningPoint(store, user.id, PREVIEW_LP, "open-repeat-3");

  const overview = await store.getLearningOverview(user.id);
  const card = overview.courses.find((item) => item.courseId === COURSE_ID);
  assert.equal(card?.openedLearningPointCount, 1);
  assert.equal(card?.progress, 50);
});

test("ML-FR-009: text and video events on the same lesson count as one Learning Point", async () => {
  const user = await verifiedUser(store, "ml-fr-007-media@example.test");
  await purchaseCourse(store, user.id);
  await store.recordStudyEvent({
    userId: user.id,
    courseId: COURSE_ID,
    lessonId: PREVIEW_LP,
    event: "text_progress",
    seconds: 300,
    clientEventId: "text-same-lp",
  });
  await store.recordStudyEvent({
    userId: user.id,
    courseId: COURSE_ID,
    lessonId: PREVIEW_LP,
    event: "video_progress",
    seconds: 300,
    clientEventId: "video-same-lp",
  });

  const overview = await store.getLearningOverview(user.id);
  const card = overview.courses.find((item) => item.courseId === COURSE_ID);
  assert.equal(card?.openedLearningPointCount, 1);
  assert.equal(card?.progress, 50);
});

test("ML-FR-007: completing a lesson by duration must not report 56% time progress", async () => {
  const user = await verifiedUser(store, "ml-fr-007-complete@example.test");
  await purchaseCourse(store, user.id);
  const record = await store.recordStudyEvent({
    userId: user.id,
    courseId: COURSE_ID,
    lessonId: PREVIEW_LP,
    event: "complete",
    seconds: 1500,
    clientEventId: "complete-first-lp",
  });

  assert.notEqual(record?.progress, 56);
  assert.equal(record?.progress, 50);

  const overview = await store.getLearningOverview(user.id);
  const card = overview.courses.find((item) => item.courseId === COURSE_ID);
  assert.equal(card?.progress, 50);
  assert.equal(card?.cardState, "learning");
});

test("ML-FR-007: three fresh 300s video_progress bursts do not change unique-LP progress", async () => {
  const user = await verifiedUser(store, "ml-fr-007-inject@example.test");
  await purchaseCourse(store, user.id);
  await openLearningPoint(store, user.id, PREVIEW_LP, "inject-open");
  await store.recordStudyEvent({
    userId: user.id,
    courseId: COURSE_ID,
    lessonId: PREVIEW_LP,
    event: "video_progress",
    seconds: 300,
    clientEventId: "inject-1",
  });
  await store.recordStudyEvent({
    userId: user.id,
    courseId: COURSE_ID,
    lessonId: PREVIEW_LP,
    event: "video_progress",
    seconds: 300,
    clientEventId: "inject-2",
  });
  await store.recordStudyEvent({
    userId: user.id,
    courseId: COURSE_ID,
    lessonId: PREVIEW_LP,
    event: "video_progress",
    seconds: 300,
    clientEventId: "inject-3",
  });

  const overview = await store.getLearningOverview(user.id);
  const card = overview.courses.find((item) => item.courseId === COURSE_ID);
  assert.equal(card?.progress, 50);
  assert.equal(card?.openedLearningPointCount, 1);
});

test("ML-FR-010: opening every Learning Point is Completed at 100%, not a percent label", async () => {
  const user = await verifiedUser(store, "ml-fr-007-done@example.test");
  await purchaseCourse(store, user.id);
  await openLearningPoint(store, user.id, PREVIEW_LP, "done-1");
  await openLearningPoint(store, user.id, PRIVATE_LP, "done-2");

  const overview = await store.getLearningOverview(user.id);
  const card = overview.courses.find((item) => item.courseId === COURSE_ID);
  assert.equal(card?.openedLearningPointCount, 2);
  assert.equal(card?.totalLearningPoints, 2);
  assert.equal(card?.progress, 100);
  assert.equal(card?.cardState, "completed");
  assert.equal(card?.cta, "review_course");
  assert.ok(card?.completedAt);
});

test("ML-FR-009: preview opens merge into paid unique-LP progress after purchase", async () => {
  const user = await verifiedUser(store, "ml-fr-007-merge@example.test");
  await openLearningPoint(store, user.id, PREVIEW_LP, "preview-before-pay", "preview");
  await purchaseCourse(store, user.id);
  await openLearningPoint(store, user.id, PRIVATE_LP, "paid-second-lp");

  const overview = await store.getLearningOverview(user.id);
  const card = overview.courses.find((item) => item.courseId === COURSE_ID);
  assert.equal(card?.openedLearningPointCount, 2);
  assert.equal(card?.progress, 100);
  assert.equal(card?.cardState, "completed");
});

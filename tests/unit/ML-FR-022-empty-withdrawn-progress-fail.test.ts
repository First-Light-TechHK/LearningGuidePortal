import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  COURSE_ID,
  PREVIEW_LP,
  openLearningPoint,
  purchaseCourse,
  readProductData,
  verifiedUser,
  writeProductData,
} from "./helpers/my-learning";

// Break: ML-FR-022 empty / withdrawn / progress-failed cards. Progress
// interface failure must not render as 0%. Unpublished card has no CTA.

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-ml-fr-022-"));
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

test("ML-FR-022: unpublished started course is withdrawn with no CTA", async () => {
  const user = await verifiedUser(store, "ml-fr-022-withdrawn@example.test");
  await purchaseCourse(store, user.id);
  await openLearningPoint(store, user.id, PREVIEW_LP, "before-unpublish");
  await store.setCourseStatus(COURSE_ID, "draft");

  const overview = await store.getLearningOverview(user.id);
  const card = overview.courses.find((item) => item.courseId === COURSE_ID);
  assert.ok(card, "withdrawn course remains on Overview");
  assert.equal(card.cardState, "withdrawn");
  assert.equal(card.cta, null);
  assert.equal(card.courseStatus, "draft");
});

test("ML-FR-022: missing course progress must not look like 0%", async () => {
  const user = await verifiedUser(store, "ml-fr-022-ghost@example.test");
  await purchaseCourse(store, user.id);
  const data = await readProductData();
  data.studyRecords.unshift({
    id: "study_ghost",
    userId: user.id,
    courseId: "ghost-course",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentLessonId: "ghost-lp",
    totalSeconds: 0,
    progress: 0,
    completedAt: null,
  });
  data.studyEvents.push({
    id: "study_event_ghost",
    userId: user.id,
    courseId: "ghost-course",
    lessonId: "ghost-lp",
    event: "open",
    seconds: 0,
    clientEventId: "ghost-open",
    createdAt: new Date().toISOString(),
  });
  await writeProductData(data);

  const overview = await store.getLearningOverview(user.id);
  const card = overview.courses.find((item) => item.courseId === "ghost-course");
  // api-contracts.md §Overview real-record display: "Missing progress renders
  // unavailable, withdrawn/missing courses are omitted". A record orphaned from a
  // Course that no longer exists must not surface a card that would link nowhere —
  // and must never be shown as 0% either. Only records with a readable Course stay.
  assert.equal(card, undefined, "a record for a course that no longer exists is omitted");
  assert.equal(
    overview.courses.some((item) => item.courseId === "ghost-course"),
    false,
    "no ghost course leaks into the overview",
  );
});

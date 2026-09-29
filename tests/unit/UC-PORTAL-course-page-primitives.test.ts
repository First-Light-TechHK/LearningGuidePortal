import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "os";
import path from "path";
import {
  COURSE_ID,
  PREVIEW_LP,
  PRIVATE_LP,
  activateThreeDayTrial,
  openLearningPoint,
  purchaseCourse,
  readProductData,
  verifiedUser,
  writeProductData,
} from "./helpers/my-learning";

// Break: portal course page must expose store primitives — identity, syllabus
// access, My Learning CTA bands, unique-LP preview progress, withdrawn/failed.
// Chrome leftovers (hardcoded "Course" / "Self-paced" / silent notFound) fail these.

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-uc-portal-course-"));
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

test("UC-PORTAL-1: course identity comes from the product store, not KS leftovers", async () => {
  const page = await store.getCoursePage(COURSE_ID, null);

  assert.equal(page.pageState, "available");
  const identity = page.identity;
  assert.ok(identity);
  assert.equal(identity.title, "Epicureanism");
  assert.equal(identity.track, "European Humanities");
  assert.equal(identity.lessonCount, 2);
  assert.equal(identity.previewAvailable, true);
  assert.equal(identity.totalMinutes, 45);
  assert.notEqual(identity.track, "Course");
});

test("UC-PORTAL-1: visitor syllabus is previewable vs locked", async () => {
  const page = await store.getCoursePage(COURSE_ID, null);
  const preview = page.syllabus.find((item) => item.lessonId === PREVIEW_LP);
  const locked = page.syllabus.find((item) => item.lessonId === PRIVATE_LP);

  assert.equal(page.syllabus.length, 2);
  assert.equal(preview?.access, "previewable");
  assert.equal(preview?.openable, true);
  assert.equal(locked?.access, "locked");
  assert.equal(locked?.openable, false);
  assert.equal(page.cta, "start_preview");
  assert.equal(page.secondaryCta, "view_plans");
  assert.equal(page.accessState, "none");
});

test("ML-FR-004: opening a preview LP records unique progress and switches CTA to Continue preview", async () => {
  const user = await verifiedUser(store, "uc-portal-preview-open@example.test");
  const before = await store.getCoursePage(COURSE_ID, user.id);
  assert.equal(before.cta, "start_preview");
  assert.equal(before.openedLearningPointCount, 0);

  await openLearningPoint(store, user.id, PREVIEW_LP, "course-page-preview-open", "preview");

  const page = await store.getCoursePage(COURSE_ID, user.id);
  assert.equal(page.cta, "continue_preview");
  assert.equal(page.secondaryCta, "view_plans");
  assert.equal(page.openedLearningPointCount, 1);
  assert.equal(page.totalLearningPoints, 2);
  assert.equal(page.progress, 50);

  const overview = await store.getLearningOverview(user.id);
  const card = overview.courses.find((item) => item.courseId === COURSE_ID);
  assert.ok(card, "preview open must mint the ML card");
  assert.equal(card.cardState, "previewing");
  assert.equal(card.cta, "continue_preview");
  assert.equal(card.progress, 50);
});

test("ML-FR-005: completing the preview range is View plans, not Continue preview", async () => {
  const user = await verifiedUser(store, "uc-portal-preview-limit@example.test");
  await store.recordStudyEvent({
    userId: user.id,
    courseId: COURSE_ID,
    lessonId: PREVIEW_LP,
    event: "complete",
    seconds: 0,
    clientEventId: "course-page-preview-complete",
  }, "preview");

  const page = await store.getCoursePage(COURSE_ID, user.id);
  assert.equal(page.cta, "view_plans");
  const locked = page.syllabus.find((item) => item.lessonId === PRIVATE_LP);
  assert.equal(locked?.access, "locked");
});

test("UC-PORTAL depth: paid access still reads identity from the store", async () => {
  const user = await verifiedUser(store, "uc-portal-depth-identity@example.test");
  await purchaseCourse(store, user.id);
  const page = await store.getCoursePage(COURSE_ID, user.id);
  assert.equal(page.identity?.title, "Epicureanism");
  assert.equal(page.identity?.track, "European Humanities");
  assert.notEqual(page.identity?.track, "Course");
  assert.equal(page.accessState, "active");
});

test("UC-PORTAL-4: subscribed access marks every LP entitled and Continue learning", async () => {
  const user = await verifiedUser(store, "uc-portal-subscribed@example.test");
  await purchaseCourse(store, user.id);
  await openLearningPoint(store, user.id, PRIVATE_LP, "course-page-paid-open");

  const page = await store.getCoursePage(COURSE_ID, user.id);
  assert.equal(page.accessState, "active");
  assert.equal(page.cta, "continue_learning");
  assert.equal(page.secondaryCta, null);
  assert.ok(page.syllabus.every((item) => item.access === "entitled" && item.openable));
});

test("UC-PORTAL depth: expired access still reads identity from the store", async () => {
  const user = await verifiedUser(store, "uc-portal-depth-expired@example.test");
  await purchaseCourse(store, user.id);
  const paid = (await store.getLearningOverview(user.id)).orders.find(
    (order) => order.status === "paid" && order.kind !== "trial_activation",
  );
  assert.ok(paid);
  await store.refundDemoOrder(paid.id);
  const page = await store.getCoursePage(COURSE_ID, user.id);
  assert.equal(page.identity?.title, "Epicureanism");
  assert.equal(page.accessState, "expired");
  assert.notEqual(page.identity?.track, "Course");
});

test("UC-PORTAL-5: expired access is View plans and private LPs lock again", async () => {
  const user = await verifiedUser(store, "uc-portal-expired@example.test");
  await purchaseCourse(store, user.id);
  await openLearningPoint(store, user.id, PREVIEW_LP, "course-page-before-refund");
  const paid = (await store.getLearningOverview(user.id)).orders.find(
    (order) => order.status === "paid" && order.kind !== "trial_activation",
  );
  assert.ok(paid);
  await store.refundDemoOrder(paid.id);

  const page = await store.getCoursePage(COURSE_ID, user.id);
  assert.equal(page.accessState, "expired");
  assert.equal(page.cta, "view_plans");
  assert.equal(page.syllabus.find((item) => item.lessonId === PREVIEW_LP)?.access, "previewable");
  assert.equal(page.syllabus.find((item) => item.lessonId === PRIVATE_LP)?.access, "locked");
});

test("three trial stories stay distinct: 3-day $0 trial is Continue learning, not preview minutes", async () => {
  const user = await verifiedUser(store, "uc-portal-three-day-trial@example.test");
  await activateThreeDayTrial(store, user.id);

  const page = await store.getCoursePage(COURSE_ID, user.id);
  assert.ok((await store.checkEntitlement(user.id, COURSE_ID)).allowed);
  assert.equal(page.cta, "continue_learning");
  assert.notEqual(page.cta, "start_preview");
  assert.notEqual(page.cta, "continue_preview");
  assert.ok(page.syllabus.every((item) => item.access === "entitled"));
});

test("ML-FR-022: unpublished course is withdrawn with identity, not a silent empty page", async () => {
  const now = new Date().toISOString();
  const data = await readProductData();
  data.courses.push({
    id: "stoicism-draft",
    slug: "stoicism-draft",
    title: "Stoicism",
    description: "An unpublished companion course.",
    category: "European Humanities",
    thumbnailPath: null,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    sections: [{
      id: "stoic-foundations",
      title: "Foundations",
      lessons: [{
        id: "dichotomy-of-control",
        title: "Dichotomy of Control",
        durationMinutes: 15,
        isPublic: true,
        body: "Draft lesson.",
      }],
    }],
  });
  await writeProductData(data);

  const page = await store.getCoursePage("stoicism-draft", null);
  assert.equal(page.pageState, "withdrawn");
  assert.equal(page.cta, null);
  const identity = page.identity;
  assert.ok(identity);
  assert.equal(identity.title, "Stoicism");
  assert.equal(identity.track, "European Humanities");
  assert.equal(identity.lessonCount, 1);
  assert.notEqual(page.pageState, "available");
});

test("unreadable slug is failed, not an empty published template", async () => {
  const page = await store.getCoursePage("no-such-course", null);
  assert.equal(page.pageState, "failed");
  assert.equal(page.cta, null);
  assert.equal(page.identity, null);
  assert.equal(page.syllabus.length, 0);
});

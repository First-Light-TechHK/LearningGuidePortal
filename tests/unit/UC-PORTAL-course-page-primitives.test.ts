import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "os";
import path from "path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getMessages } from "../../lib/i18n/messages";
import type { CoursePage } from "../../lib/coursePage";
import type { CourseCurriculumAction } from "../../components/portal/CourseCurriculumAction";
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
let Action: typeof CourseCurriculumAction;

function assertCurriculumActions(page: CoursePage) {
  for (const locale of ["en-GB", "zh-CN"] as const) {
    const copy = getMessages(locale).courseDetailDesign;
    for (const lesson of page.syllabus) {
      const href = !lesson.openable ? null : lesson.access === "entitled"
        ? `/${locale}/account/learn/${COURSE_ID}?lessonId=${lesson.lessonId}`
        : `/${locale}/portal/courses/${COURSE_ID}/public-lesson?lessonId=${lesson.lessonId}`;
      const html = renderToStaticMarkup(createElement(Action, { lesson, href, copy, className: "preview", cta: page.cta }));
      assert.ok(html.includes(`>${lesson.access === "entitled" ? copy.start : copy.preview}</`), html);
      if (href) {
        assert.ok(html.includes(`href="${href}"`), html);
        assert.ok(!html.includes("disabled"), html);
      } else {
        assert.ok(html.includes("<button") && html.includes("disabled"), html);
        assert.ok(!html.includes("href="), html);
      }
    }
  }
}

before(async () => {
  const bundle = await build({ entryPoints: [path.join(originalCwd, "components/portal/CourseCurriculumAction.tsx")], bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", external: ["react", "react/jsx-runtime", "next/link"] });
  const compiled = { exports: {} as { CourseCurriculumAction: typeof CourseCurriculumAction } };
  new Function("module", "exports", "require", bundle.outputFiles[0].text)(compiled, compiled.exports, createRequire(import.meta.url));
  Action = compiled.exports.CourseCurriculumAction;
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
  assertCurriculumActions(page);
});

test("UC-PORTAL-1: a later lesson remains locked even when legacy data marks it public", async () => {
  const data = await readProductData();
  const course = data.courses.find((item: { id: string }) => item.id === COURSE_ID);
  assert.ok(course);
  course.sections[0].lessons[1].isPublic = true;
  await writeProductData(data);

  const page = await store.getCoursePage(COURSE_ID, null);
  assert.equal(page.syllabus.find((item) => item.lessonId === PRIVATE_LP)?.access, "locked");

  const user = await verifiedUser(store, "uc-portal-second-preview@example.test");
  await assert.rejects(
    () => openLearningPoint(store, user.id, PRIVATE_LP, "second-lesson-preview", "preview"),
    /outside the preview range/,
  );
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
  assertCurriculumActions(page);

  const overview = await store.getLearningOverview(user.id);
  const card = overview.courses.find((item) => item.courseId === COURSE_ID);
  assert.ok(card, "preview open must mint the ML card");
  assert.equal(card.cardState, "previewing");
  assert.equal(card.cta, "continue_preview");
  assert.equal(card.progress, 50);
});

test("ML-FR-005: completing a preview lesson is rejected", async () => {
  const user = await verifiedUser(store, "uc-portal-preview-limit@example.test");
  await assert.rejects(() => store.recordStudyEvent({
    userId: user.id,
    courseId: COURSE_ID,
    lessonId: PREVIEW_LP,
    event: "complete",
    seconds: 0,
    clientEventId: "course-page-preview-complete",
  }, "preview"), /Preview lessons cannot be completed/);

  const page = await store.getCoursePage(COURSE_ID, user.id);
  assert.equal(page.cta, "start_preview");
  const locked = page.syllabus.find((item) => item.lessonId === PRIVATE_LP);
  assert.equal(locked?.access, "locked");
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
  assertCurriculumActions(page);
});

test("Everything subscription grants Start actions for every published course and lesson", async () => {
  const user = await verifiedUser(store, "uc-portal-everything@example.test");
  const { quote } = await store.createQuote(user.id, "everything-pc-6");
  const { order } = await store.createPendingDemoOrder(user.id, quote.id);
  await store.completeDemoOrder(user.id, order.id);
  for (const course of await store.listPublishedCourses()) {
    assert.equal((await store.checkEntitlement(user.id, course.id)).allowed, true);
    const page = await store.getCoursePage(course.slug, user.id);
    assert.ok(page.syllabus.every(lesson => lesson.access === "entitled" && lesson.openable));
    assertCurriculumActions(page);
  }
});

test("an expired earlier entitlement must not hide valid Everything access", async () => {
  const user = await verifiedUser(store, "uc-portal-everything-overlap@example.test");
  const { quote } = await store.createQuote(user.id, "everything-pc-6");
  const { order } = await store.createPendingDemoOrder(user.id, quote.id);
  await store.completeDemoOrder(user.id, order.id);
  const data = await readProductData();
  data.entitlements.unshift({ id:"old-course-entitlement", userId:user.id, courseId:COURSE_ID, scope:"course", scopeId:COURSE_ID, source:"purchase", state:"active", validTo:new Date(Date.now()-86400000).toISOString() });
  await writeProductData(data);
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, true);
  data.entitlements[0].validTo = "invalid-date";
  await writeProductData(data);
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, true);
  const everything = data.entitlements.find((item: { userId:string; scope:string }) => item.userId === user.id && item.scope === "everything");
  assert.ok(everything);
  everything.state = "revoked";
  await writeProductData(data);
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, false,"invalid expiry and revoked Everything cannot grant access");
  everything.state = "active";
  await writeProductData(data);
  const page = await store.getCoursePage(COURSE_ID, user.id);
  assertCurriculumActions(page);
  assert.ok(page.syllabus.every(lesson => lesson.access === "entitled"));
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
  assertCurriculumActions(page);
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
  assertCurriculumActions(page);
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

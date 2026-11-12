import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { isolate, callRoute, setCookie, clearCookies, SESSION_COOKIE, jsonRequest } from "../io/harness";
import { verifiedUser, purchaseCourse, readProductData, writeProductData, COURSE_ID, PREVIEW_LP, PRIVATE_LP } from "./helpers/my-learning";
import { getOverviewDisplay } from "../../services/overviewDisplay";

let restore: () => Promise<void>, store: typeof import("../../services/productStore");
let preview: typeof import("../../app/api/study/preview/route");
before(async () => { restore = (await isolate("lg-preview-isolation-")).restore; store = await import("../../services/productStore"); preview = await import("../../app/api/study/preview/route"); });
after(async () => { await restore(); });
const event = (userId: string, clientEventId: string, lessonId = PREVIEW_LP) => ({ userId, courseId: COURSE_ID, lessonId, event: "open" as const, seconds: 10, clientEventId });

test("preview open, repeat and progress never persist, and subscription starts at zero before actual learning", async () => {
  const user = await verifiedUser(store, "preview-new@example.test");
  assert.equal(await store.recordStudyEvent(event(user.id, "preview-open"), "preview"), null);
  assert.equal(await store.recordStudyEvent(event(user.id, "preview-open"), "preview"), null);
  assert.equal(await store.recordStudyEvent({ ...event(user.id, "preview-progress"), event: "video_progress", seconds: 30 }, "preview"), null);
  let data = await readProductData();
  assert.equal(data.studyRecords.filter((item: { userId: string }) => item.userId === user.id).length, 0);
  assert.equal(data.studyEvents.filter((item: { userId: string }) => item.userId === user.id).length, 0);
  assert.deepEqual((await getOverviewDisplay(user.id, "Learner", "en-GB")).courses, []);
  await purchaseCourse(store, user.id);
  const page = await store.getCoursePage(COURSE_ID, user.id);
  assert.equal(page.progress, 0); assert.equal(page.openedLearningPointCount, 0); assert.equal(page.actionLessonId, PREVIEW_LP);
  assert.deepEqual((await store.getLearningOverview(user.id)).courses, []);
  await store.recordStudyEvent(event(user.id, "preview-open"));
  assert.equal((await store.getLearningOverview(user.id)).courses.length, 1, "only actual entitled learning adds the course");
  data = await readProductData();
  assert.equal(data.studyEvents.find((item: { clientEventId: string }) => item.clientEventId === "preview-open").accessContext, "entitled");
});

test("historical preview rows do not become progress after purchase and mixed genuine learning is preserved", async () => {
  const user = await verifiedUser(store, "preview-legacy@example.test");
  let data = await readProductData();
  data.studyRecords.push({ id: "legacy-preview-record", userId: user.id, courseId: COURSE_ID, startedAt: "2000-01-01T00:00:00Z", updatedAt: "2000-01-01T00:00:00Z", currentLessonId: PREVIEW_LP, totalSeconds: 200, progress: 100, completedAt: "2000-01-01T00:00:00Z" });
  data.studyEvents.push({ id: "legacy-preview-event", ...event(user.id, "legacy-preview"), createdAt: "2000-01-01T00:00:00Z" });
  await writeProductData(data);
  assert.deepEqual((await store.getLearningOverview(user.id)).courses, []);
  await purchaseCourse(store, user.id);
  const before = await readProductData();
  assert.equal((await store.getCoursePage(COURSE_ID, user.id)).progress, 0);
  assert.deepEqual((await getOverviewDisplay(user.id, "Learner", "zh-CN")).courses, []);
  await store.saveCourseLearningMode(user.id, COURSE_ID, "text", PREVIEW_LP);
  assert.equal((await store.getCoursePage(COURSE_ID, user.id)).progress, 0);
  const after = await readProductData();
  assert.deepEqual(after.studyEvents, before.studyEvents, "reads and mode choice do not purge historical events");
  assert.deepEqual(after.studyRecords, before.studyRecords, "a preview-only aggregate is not promoted by mode selection");
  await store.recordStudyEvent({ ...event(user.id, "actual-learning"), seconds: 0 });
  let view = await store.getLearningOverview(user.id);
  assert.equal(view.courses[0].progress, 0); assert.equal(view.courses[0].totalSeconds, 0);
  data = await readProductData();
  assert.equal(data.studyRecords.filter((item: { userId: string }) => item.userId === user.id).length, 1);
  assert.equal(data.studyEvents.some((item: { id: string }) => item.id === "legacy-preview-event"), true);
  // Reproduce a pre-provenance aggregate containing both preview and genuine post-purchase events.
  const record = data.studyRecords.find((item: { userId: string }) => item.userId === user.id);
  delete record.accessContext; record.startedAt = "2000-01-01T00:00:00Z"; record.totalSeconds = 999; record.progress = 100;
  const actual = data.studyEvents.find((item: { clientEventId: string }) => item.clientEventId === "actual-learning"); delete actual.accessContext;
  await writeProductData(data);
  view = await store.getLearningOverview(user.id);
  assert.equal(view.courses[0].progress, 0); assert.equal(view.courses[0].totalSeconds, 0);
  assert.equal((await store.getCoursePage(COURSE_ID, user.id)).actionLessonId, PREVIEW_LP);
});

test("preview API ignores forged access flags, denies locked/completion/anonymous events and saves entitled learning", async () => {
  clearCookies();
  const request = (body: unknown) => jsonRequest("POST", "http://localhost/api/study/preview", body);
  assert.equal((await callRoute(preview.POST, request({ courseId: COURSE_ID, lessonId: PREVIEW_LP, event: "open" }))).status, 401);
  const user = await verifiedUser(store, "preview-api@example.test"), session = await store.createSession(user.id); setCookie(SESSION_COOKIE, session.token);
  const body = { courseId: COURSE_ID, lessonId: PREVIEW_LP, event: "open", clientEventId: "api-preview", accessContext: "entitled" };
  for (let i = 0; i < 2; i++) {
    const response = await callRoute(preview.POST, request(body)); assert.equal(response.status, 200); assert.equal((await response.json()).record, null);
  }
  assert.equal((await callRoute(preview.POST, request({ ...body, event: "complete" }))).status, 403);
  assert.equal((await callRoute(preview.POST, request({ ...body, lessonId: PRIVATE_LP }))).status, 400);
  assert.deepEqual((await store.getLearningOverview(user.id)).courses, []);
  await purchaseCourse(store, user.id);
  assert.equal((await callRoute(preview.POST, request(body))).status, 200);
  assert.equal((await store.getLearningOverview(user.id)).courses.length, 1);
});

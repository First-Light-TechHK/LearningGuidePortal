import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { isolate, setCookie, clearCookies, SESSION_COOKIE, jsonRequest } from "../io/harness";
import { verifiedUser, readProductData, writeProductData, COURSE_ID, PREVIEW_LP, PRIVATE_LP } from "./helpers/my-learning";
import { knowledgeProgress } from "../../lib/knowledgeProgress";
import type { ProductCourse } from "../../services/productStore";

test("course outline percentages only increase across revisits, modes, concurrency and lesson completion", async () => {
  const { restore } = await isolate("lg-maximum-progress-");
  try {
    const store = await import("../../services/productStore");
    const user = await verifiedUser(store, "maximum@example.test");
    const { quote } = await store.createQuote(user.id, "everything-pc-6"); await store.completeDemoCheckout(user.id, quote.id);
    const data = await readProductData(), course = data.courses.find((item: ProductCourse) => item.id === COURSE_ID);
    const lessons = course.sections.flatMap((section: any) => section.lessons);
    for (const [index, lesson] of lessons.entries()) lesson.contents = Array.from({ length: index ? 2 : 3 }, (_, point) => [
      { id: `t${index ? point + 4 : point + 1}`, type: "text", title: "Text", mode: "lecture", html: "Reading", nodes: [] },
      { id: `v${index ? point + 4 : point + 1}`, type: "video", title: "Video", mode: "lecture", url: "/video.mp4", nodes: [] },
    ]).flat();
    await writeProductData(data);
    const send = (lessonId: string, contentId: string, learningMode: "video" | "text", clientEventId = randomUUID()) => store.recordStudyEvent({ userId: user.id, courseId: COURSE_ID, lessonId, contentId, learningMode, event: "open", seconds: 0, clientEventId });
    assert.equal((await send(PREVIEW_LP, "t1", "text"))!.progress, 20, "the initial text point counts immediately");
    assert.equal((await send(PREVIEW_LP, "t3", "text"))!.progress, 60);
    const old = await send(PREVIEW_LP, "t2", "text");
    assert.equal(old!.progress, 60); assert.equal(old!.knowledgePositions?.text?.contentId, "t2", "resume position may move without lowering progress");
    const sameId = randomUUID(); const same = await send(PREVIEW_LP, "t3", "text", sameId);
    const beforeReplay = (await readProductData()).studyEvents.length;
    assert.deepEqual(await send(PREVIEW_LP, "t1", "text", sameId), same);
    assert.equal((await readProductData()).studyEvents.length, beforeReplay);
    const complete = { userId: user.id, courseId: COURSE_ID, lessonId: PREVIEW_LP, learningMode: "text" as const, event: "complete" as const, completeLesson: true, seconds: 0, clientEventId: randomUUID() };
    const first = await store.recordStudyEvent(complete); assert.equal(first!.progress, 60);
    assert.deepEqual(await store.recordStudyEvent(complete), first);
    let overview = (await store.getLearningOverview(user.id)).courses[0];
    assert.deepEqual(overview.completedContentIds.sort(), ["t1", "t2", "t3"]);
    assert.deepEqual(overview.completedLessonIds, [PREVIEW_LP]);
    assert.equal((await send(PREVIEW_LP, "v1", "video"))!.progress, 60, "switching mode retains the course maximum");
    await Promise.all([send(PRIVATE_LP, "t4", "text"), send(PREVIEW_LP, "v2", "video")]);
    assert.equal((await store.getLearningOverview(user.id)).courses[0].progress, 80);
    const final = await store.recordStudyEvent({ ...complete, lessonId: PRIVATE_LP, clientEventId: randomUUID() });
    assert.equal(final!.progress, 100); assert.ok(final!.completedAt);
    await send(PREVIEW_LP, "t1", "text");
    overview = (await store.getLearningOverview(user.id)).courses[0]; assert.equal(overview.progress, 100);
    assert.equal((await store.getCoursePage(COURSE_ID, user.id)).progress, 100);
    assert.equal((await (await import("../../services/overviewDisplay")).getOverviewDisplay(user.id, user.nickname, "en-GB")).courses[0].progress, 100);
    const legacy = await readProductData();
    const legacyCourse = structuredClone(course); legacyCourse.id = "legacy-max"; legacyCourse.slug = "legacy-max";
    legacyCourse.sections.flatMap((section: any) => section.lessons).forEach((lesson: any) => { delete lesson.contents; lesson.body = "Legacy reading"; });
    legacy.courses.push(legacyCourse);
    legacy.studyRecords.push({ id: "legacy-max-record", userId: user.id, courseId: legacyCourse.id, currentLessonId: PREVIEW_LP, progress: 90, totalSeconds: 0, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null });
    await writeProductData(legacy);
    await store.recordStudyEvent({ userId: user.id, courseId: legacyCourse.id, lessonId: PREVIEW_LP, event: "open", seconds: 0, clientEventId: randomUUID() });
    assert.equal((await store.getLearningOverview(user.id)).courses.find(item => item.courseId === legacyCourse.id)!.progress, 90, "legacy history also displays its saved maximum");
    const other = await verifiedUser(store, "video-maximum@example.test");
    const otherQuote = await store.createQuote(other.id, "everything-pc-6"); await store.completeDemoCheckout(other.id, otherQuote.quote.id);
    assert.equal((await store.getLearningOverview(other.id)).courses.length, 0);
    const video = await store.recordStudyEvent({ ...complete, userId: other.id, learningMode: "video", clientEventId: randomUUID() });
    assert.equal(video!.progress, 60);
    assert.deepEqual((await store.getLearningOverview(other.id)).courses[0].completedContentIds.sort(), ["v1", "v2", "v3"]);
    const routes = await import("../../app/api/study/events/route");
    const preview = await import("../../app/api/study/preview/route");
    const body = { ...complete, clientEventId: randomUUID() };
    clearCookies(); assert.equal((await routes.POST(jsonRequest("POST", "http://localhost/api/study/events", body))).status, 401);
    setCookie(SESSION_COOKIE, (await store.createSession(other.id)).token);
    assert.equal((await routes.POST(jsonRequest("POST", "http://localhost/api/study/events", body))).status, 200);
    assert.equal((await routes.POST(jsonRequest("POST", "http://localhost/api/study/events", { ...body, completeLesson: "true" }))).status, 400);
    const visitor = await verifiedUser(store, "maximum-preview@example.test"); setCookie(SESSION_COOKIE, (await store.createSession(visitor.id)).token);
    assert.equal((await preview.POST(jsonRequest("POST", "http://localhost/api/study/preview", body))).status, 403);
    assert.equal((await routes.POST(jsonRequest("POST", "http://localhost/api/study/events", body))).status, 403);
    setCookie(SESSION_COOKIE, (await store.createSession(user.id)).token);
    const expired = await readProductData(); expired.entitlements.filter((item: any) => item.userId === user.id).forEach((item: any) => { item.validTo = "2020-01-01"; }); await writeProductData(expired);
    assert.equal((await routes.POST(jsonRequest("POST", "http://localhost/api/study/events", { ...body, clientEventId: randomUUID() }))).status, 403);
  } finally { await restore(); }
});

test("rounding cannot report 100 before reaching the last active outline point", () => {
  const course = { sections: [{ lessons: [{ id: "one", contents: Array.from({ length: 1000 }, (_, index) => ({ id: String(index), type: "text" })) }] }] } as ProductCourse;
  assert.equal(knowledgeProgress(course, "text", { lessonId: "one", contentId: "998" }).progress, 99);
  assert.equal(knowledgeProgress(course, "text", { lessonId: "one", contentId: "999" }).progress, 100);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { stop } from "esbuild";
import { isolate, SESSION_COOKIE } from "./harness";
import { COURSE_ID, PREVIEW_LP, PRIVATE_LP, purchaseCourse, readProductData, verifiedUser, writeProductData } from "../unit/helpers/my-learning";

test("mode-switch service/API resume the last reviewed point instead of the Course maximum or completion endpoint", async () => {
  const { restore } = await isolate("lg-mode-cursor-");
  try {
    const store = await import("../../services/productStore");
    const user = await verifiedUser(store, "mode-maximum@example.test"); await purchaseCourse(store, user.id);
    const data = await readProductData(), course = data.courses.find((row: { id: string }) => row.id === COURSE_ID);
    for (const lesson of course.sections.flatMap((section: { lessons: any[] }) => section.lessons)) {
      lesson.preview = { textPointCount: 2, videoLimitSeconds: 1 };
      lesson.contents = ["text", "video"].flatMap(type => [1, 2, 3, 4].map(n => ({ id: `${lesson.id}-${type}-${n}`, title: `${type} ${n}`, type, mode: "lecture", ...(type === "text" ? { html: `<p>Point ${n}</p>` } : { url: "/portal/text-exhibits/flowers.webm", startSeconds: n >= 3 ? 2 : (n - 1) / 2 }), nodes: [] })));
    }
    await writeProductData(data);
    let count = 0;
    const open = (lessonId: string, mode: "text" | "video", n: number, extra = {}) => store.recordStudyEvent({ userId: user.id, courseId: COURSE_ID, lessonId, learningMode: mode, contentId: `${lessonId}-${mode}-${n}`, event: "open", seconds: 0, clientEventId: `maximum-${++count}`, ...extra });
    await open(PRIVATE_LP, "text", 4); await open(PREVIEW_LP, "text", 3);
    await open(PRIVATE_LP, "video", 4); await open(PREVIEW_LP, "video", 2);
    const before = await readProductData(), original = before.studyRecords.find((row: { userId: string }) => row.userId === user.id);
    assert.deepEqual((await store.saveCourseLearningMode(user.id, COURSE_ID, "text", PREVIEW_LP)).position, { lessonId: PREVIEW_LP, contentId: `${PREVIEW_LP}-text-3` });
    assert.deepEqual((await store.saveCourseLearningMode(user.id, COURSE_ID, "video", PRIVATE_LP)).position, { lessonId: PREVIEW_LP, contentId: `${PREVIEW_LP}-video-2` });
    const token = (await store.createSession(user.id)).token;
    const { PUT } = await import("../../app/api/courses/[courseId]/learning-mode/route");
    const invoke = (mode: string, lessonId: unknown = PREVIEW_LP, session = token) => PUT(new Request(`http://localhost/api/courses/${COURSE_ID}/learning-mode`, {
      method: "PUT", headers: { origin: "http://localhost", cookie: `${SESSION_COOKIE}=${session}` }, body: JSON.stringify({ mode, lessonId }),
    }), { params: Promise.resolve({ courseId: COURSE_ID }) });
    const response = await invoke("text"); assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data.position, { lessonId: PREVIEW_LP, contentId: `${PREVIEW_LP}-text-3` });
    const after = await readProductData(), record = after.studyRecords.find((row: { userId: string }) => row.userId === user.id);
    for (const key of ["progress", "knowledgePositions", "highestProgress", "totalSeconds", "completedAt"]) assert.deepEqual(record[key], original[key]);
    assert.deepEqual(after.studyEvents, before.studyEvents); assert.deepEqual(after.entitlements, before.entitlements);
    await open(PRIVATE_LP, "video", 1, { event: "complete", completeLesson: true });
    assert.deepEqual((await store.saveCourseLearningMode(user.id, COURSE_ID, "text", PREVIEW_LP)).position, { lessonId: PREVIEW_LP, contentId: `${PREVIEW_LP}-text-3` });
    await open(PRIVATE_LP, "text", 1, { event: "complete", completeLesson: true });
    assert.equal((await store.saveCourseLearningMode(user.id, COURSE_ID, "text", PREVIEW_LP)).position?.contentId, `${PRIVATE_LP}-text-4`);
    await open(PRIVATE_LP, "text", 2);
    assert.equal((await store.saveCourseLearningMode(user.id, COURSE_ID, "text", PREVIEW_LP)).position?.contentId, `${PRIVATE_LP}-text-2`, "review inside a completed Lesson resumes at the reviewed point");
    await open(PREVIEW_LP, "text", 3);
    const legacy = await readProductData(); delete legacy.studyRecords.find((row: { userId: string }) => row.userId === user.id).knowledgePositions.text; await writeProductData(legacy);
    assert.equal((await store.saveCourseLearningMode(user.id, COURSE_ID, "text", PREVIEW_LP)).position?.contentId, `${PREVIEW_LP}-text-3`, "missing cursors recover from the latest event, not 2.4");
    for (const invalid of [null, {}, "", " ", "x".repeat(201)]) assert.equal((await invoke("text", invalid)).status, 400);
    assert.equal((await invoke("text", "foreign-lesson")).status, 404);
    assert.equal((await invoke("text", PREVIEW_LP, "")).status, 401);
    const other = await verifiedUser(store, "other-mode-maximum@example.test");
    const otherToken = (await store.createSession(other.id)).token;
    assert.equal((await invoke("text", PRIVATE_LP, otherToken)).status, 404);
    const otherPosition = await invoke("text", PREVIEW_LP, otherToken);
    assert.deepEqual((await otherPosition.json()).data.position, { lessonId: PREVIEW_LP, contentId: `${PREVIEW_LP}-text-1` });
    const expired = await readProductData(); expired.entitlements.filter((row: { userId: string }) => row.userId === user.id).forEach((row: { validTo: string }) => { row.validTo = "2020-01-01T00:00:00Z"; }); await writeProductData(expired);
    assert.equal((await invoke("text", PRIVATE_LP)).status, 404);
    for (const mode of ["text", "video"]) {
      const preview = await invoke(mode); assert.equal(preview.status, 200);
      const position = (await preview.json()).data.position;
      assert.equal(position.lessonId, PREVIEW_LP); assert.ok([1, 2].some(n => position.contentId === `${PREVIEW_LP}-${mode}-${n}`));
    }
  } finally { await stop(); await restore(); }
});

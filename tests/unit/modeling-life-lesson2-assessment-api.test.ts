import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { isolate, clearCookies, jsonRequest, setCookie, SESSION_COOKIE } from "../io/harness";
import { verifiedUser, readProductData, writeProductData } from "./helpers/my-learning";
import { APPLICATION_TEST_EVALUATION_MS } from "../../contracts/application-test";
import type { ApplicationAttempt, KnowledgeAttempt } from "../../contracts/lesson-assessment";
import { modelingLifeLesson2Assessments } from "../../db/data-migrations/015_add_modeling_life_lesson2_assessments";

test("migrated Lesson 02 serves eight Knowledge questions and its Application reference through real gated APIs", async t => {
  const { restore } = await isolate("lg-modeling-life-lesson2-");
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  try {
    const store = await import("../../services/productStore");
    const routes = await import("../../app/api/courses/[courseId]/lessons/[lessonId]/assessments/[kind]/route");
    const { getUnderstandingOverview } = await import("../../services/understandingOverview");
    const courseId = "modeling-life", firstId = "modeling-life-lesson-1", lessonId = "modeling-life-lesson-2";
    const supplied = modelingLifeLesson2Assessments();
    const user = await verifiedUser(store, "lesson2-assessment@example.test");
    const session = await store.createSession(user.id);
    const context = (kind: string, lesson = lessonId) => ({ params: Promise.resolve({ courseId, lessonId: lesson, kind }) });
    const get = (kind = "knowledge", lesson = lessonId) => routes.GET(jsonRequest("GET", `http://localhost/api/courses/${courseId}/lessons/${lesson}/assessments/${kind}`), context(kind, lesson));
    const put = (kind: string, lesson: string, attempt: KnowledgeAttempt | ApplicationAttempt, expectedVersion = 0, clientEventId = randomUUID()) => routes.PUT(jsonRequest("PUT", `http://localhost/api/courses/${courseId}/lessons/${lesson}/assessments/${kind}`, { attempt, expectedVersion, clientEventId }), context(kind, lesson));

    assert.equal((await get()).status, 401);
    setCookie(SESSION_COOKIE, session.token);
    assert.equal((await get()).status, 403, "new definitions do not grant Course access");
    const { quote } = await store.createQuote(user.id, "science-pc-6");
    await store.completeDemoCheckout(user.id, quote.id);
    assert.equal((await get()).status, 403, "paid access cannot bypass the preceding Lesson's tests");
    assert.equal((await get("application")).status, 403);
    let overview = await getUnderstandingOverview(user.id, courseId);
    assert.equal(overview.total, 4);
    assert.equal(overview.lessons[1].knowledge.total, 8);
    assert.equal(JSON.stringify(await store.getCoursePage(courseId)).includes(supplied.knowledge[0].referenceAnswer), false, "public Course projection does not leak assessment answers");

    await store.recordStudyEvent({ userId: user.id, courseId, lessonId: firstId, event: "complete", seconds: 0, learningMode: "text", completeLesson: true, clientEventId: "lesson2-prerequisite-study" });
    const first = (await store.getProductCourse(courseId))!.sections[0].lessons[0];
    const completeKnowledge: KnowledgeAttempt = { kind: "knowledge", responses: first.assessments!.knowledge.map(() => ({ answer: "Prior Lesson note", rating: "right" })), phase: "result", index: 17 };
    assert.equal((await put("knowledge", firstId, completeKnowledge)).status, 200);
    assert.equal((await get()).status, 403, "one completed prerequisite Test does not unlock Lesson 02");
    const evaluating: ApplicationAttempt = { kind: "application", answer: "Prior Lesson application response", phase: "evaluating" };
    assert.equal((await put("application", firstId, evaluating)).status, 200);
    assert.equal((await put("application", firstId, { ...evaluating, phase: "submitted" }, 1)).status, 400);
    t.mock.timers.setTime(Date.now() + APPLICATION_TEST_EVALUATION_MS + 1);
    assert.equal((await put("application", firstId, { ...evaluating, phase: "submitted" }, 1)).status, 200);

    for (const kind of ["knowledge", "application"]) {
      const response = await get(kind);
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.data, null);
      assert.deepEqual(payload.definition, supplied);
    }
    const draft: KnowledgeAttempt = { kind: "knowledge", responses: supplied.knowledge.map(() => ({ answer: "", rating: null })), phase: "question", index: 0 };
    assert.equal((await put("knowledge", lessonId, { ...draft, responses: draft.responses.slice(0, 6) })).status, 400, "sample-sized six-question writes are rejected");
    const eventId = randomUUID(); draft.responses[0].answer = "My Lesson 02 note";
    const saved = await (await put("knowledge", lessonId, draft, 0, eventId)).json();
    assert.equal(saved.data.version, 1);
    assert.deepEqual((await (await put("knowledge", lessonId, draft, 0, eventId)).json()).data, saved.data);
    const finished: KnowledgeAttempt = { ...draft, responses: draft.responses.map(response => ({ ...response, rating: "right" })), index: 7, phase: "result" };
    assert.equal((await put("knowledge", lessonId, finished, 1)).status, 200);
    overview = await getUnderstandingOverview(user.id, courseId);
    assert.equal(overview.completed, 3);
    assert.equal(overview.lessons[1].knowledge.total, 8);
    assert.equal(overview.lessons[1].knowledge.score, 100);

    const other = await verifiedUser(store, "other-lesson2-assessment@example.test");
    setCookie(SESSION_COOKIE, (await store.createSession(other.id)).token);
    assert.equal((await get()).status, 403);
    setCookie(SESSION_COOKIE, session.token);
    const data = await readProductData();
    data.entitlements.filter((row: { userId: string }) => row.userId === user.id).forEach((row: { validTo: string }) => { row.validTo = "2000-01-01T00:00:00Z"; });
    await writeProductData(data);
    assert.equal((await get()).status, 403, "saved answers cannot bypass expired Entitlement");
    clearCookies(); assert.equal((await get("application")).status, 401);
  } finally {
    t.mock.timers.reset();
    await restore();
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { isolate, setCookie, clearCookies, SESSION_COOKIE, jsonRequest } from "../io/harness";
import { COURSE_ID, PREVIEW_LP, verifiedUser, purchaseCourse } from "./helpers/my-learning";
import { createMemoryOrm } from "../../services/migrationOrm";
import * as migration from "../../db/data-migrations/020_lesson_bookmarks";

test("bookmark migration is idempotent and does not infer or overwrite learner positions", () => {
  const orm = createMemoryOrm();
  const rows = orm.table<any>("studyRecords");
  rows.insert({ id: "legacy", progress: 80, knowledgePositions: { text: { lessonId: "one", contentId: "text" } } });
  rows.insert({ id: "existing", lessonBookmarks: { one: { video: { positionMs: 1234 } } } });
  const existing = structuredClone(rows.findById("existing"));
  assert.equal(migration.apply(orm).filter(change => change.action === "update").length, 1);
  assert.equal(migration.apply(orm).filter(change => change.action === "update").length, 0);
  assert.deepEqual(rows.findById("legacy")?.lessonBookmarks, {});
  assert.equal(rows.findById("legacy")?.progress, 80);
  assert.deepEqual(rows.findById("existing"), existing);
});

test("bookmark Route Handlers derive ownership from session and enforce origin, entitlement and input", async () => {
  const { restore } = await isolate("lesson-bookmark-api-");
  try {
    const store = await import("../../services/productStore");
    const route = await import("../../app/api/study/bookmarks/route");
    const url = "http://localhost/api/study/bookmarks";
    clearCookies();
    assert.equal((await route.GET(new Request(`${url}?courseId=${COURSE_ID}`))).status, 401);
    assert.equal((await route.POST(jsonRequest("POST", url, {}))).status, 401);
    const user = await verifiedUser(store, "bookmark-api@example.test");
    setCookie(SESSION_COOKIE, (await store.createSession(user.id)).token);
    assert.equal((await route.GET(new Request(`${url}?courseId=${COURSE_ID}`))).status, 403);
    await purchaseCourse(store, user.id);
    const read = await route.GET(new Request(`${url}?courseId=${COURSE_ID}`));
    assert.equal(read.status, 200); assert.match(read.headers.get("Cache-Control")!, /no-store/);
    const snapshot = (await read.json()).data;
    const course = (await store.getProductCourse(COURSE_ID))!;
    const lesson = course.sections.flatMap(section => section.lessons).find(item => item.id === PREVIEW_LP)!;
    const point = lesson.contents?.find(item => item.type !== "video" && item.active !== false);
    const input = { courseId: COURSE_ID, lessonId: PREVIEW_LP, mode: "text", contentId: point?.id || null, paragraphId: `${point?.id || "body"}:paragraph:0`, contentVersion: snapshot.versions[PREVIEW_LP].text, expectedRevision: 0, expectedLessonRevision: 0, clientEventId: "api-first" };
    assert.equal((await route.POST(jsonRequest("POST", url, input, { origin: "https://untrusted.test" }))).status, 403);
    assert.equal((await route.POST(jsonRequest("POST", url, { ...input, userId: "someone-else" }))).status, 400);
    assert.equal((await route.POST(jsonRequest("POST", url, input))).status, 200);
    assert.equal((await route.POST(jsonRequest("POST", url, { ...input, clientEventId: "late" }))).status, 409);
    const other = await verifiedUser(store, "bookmark-api-other@example.test"); await purchaseCourse(store, other.id);
    setCookie(SESSION_COOKIE, (await store.createSession(other.id)).token);
    assert.deepEqual((await (await route.GET(new Request(`${url}?courseId=${COURSE_ID}`))).json()).data.bookmarks, {});
  } finally { await restore(); }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { isolate } from "../io/harness";
import { COURSE_ID, PREVIEW_LP, PRIVATE_LP, verifiedUser, purchaseCourse, readProductData, writeProductData } from "./helpers/my-learning";
import { lessonBookmarkContext } from "../../services/lessonBookmarkPolicy";
import { latestLessonBookmark } from "../../lib/lessonBookmarkDisplay";
import type { ProductCourse } from "../../services/productStore";

test("independent Lesson bookmarks keep exact positions, derive LPs, reject stale and unentitled writes", async () => {
  const { restore } = await isolate("lesson-bookmarks-");
  try {
    const store = await import("../../services/productStore");
    const user = await verifiedUser(store, "bookmarks@example.test");
    const other = await verifiedUser(store, "bookmark-other@example.test");
    await assert.rejects(store.getLessonBookmarks(user.id, COURSE_ID));
    await purchaseCourse(store, user.id);
    const data = await readProductData();
    const course: ProductCourse = data.courses.find((item: ProductCourse) => item.id === COURSE_ID);
    const lesson = course.sections.flatMap(section => section.lessons).find(item => item.id === PREVIEW_LP)!;
    lesson.contents = [
      { id: "v1", type: "video", title: "One", mode: "lecture", url: "/lesson.mp4", startSeconds: 10, nodes: [] },
      { id: "v2", type: "video", title: "Two", mode: "lecture", url: "/lesson.mp4", startSeconds: 20, nodes: [] },
      { id: "t1", type: "text", title: "Text", mode: "lecture", html: "<p>First</p><p>Second</p>", nodes: [] },
    ];
    await writeProductData(data);
    const base = { courseId: COURSE_ID, lessonId: PREVIEW_LP, mode: "video" as const, contentId: "v1", contentVersion: lessonBookmarkContext(course, PREVIEW_LP, "video").contentVersion, expectedRevision: 0, expectedLessonRevision: 0, clientEventId: "video-1", positionMs: 20_125 };
    assert.deepEqual((await store.getLessonBookmarks(user.id, COURSE_ID)).bookmarks, {});
    const first = await store.saveLessonBookmark(user.id, base);
    assert.equal(first.positionMs, 20_125); assert.equal(first.lpNumber, "1.2");
    assert.deepEqual(await store.saveLessonBookmark(user.id, base), first);
    await assert.rejects(store.saveLessonBookmark(user.id, { ...base, clientEventId: "stale" }), /stale_bookmark/);
    await assert.rejects(store.saveLessonBookmark(user.id, { ...base, positionMs: 100 }), /event_conflict/);
    const backwards = await store.saveLessonBookmark(user.id, { ...base, expectedRevision: 1, expectedLessonRevision: 1, clientEventId: "video-2", positionMs: 100 });
    assert.equal(backwards.lpNumber, "1.1");
    const text = await store.saveLessonBookmark(user.id, { ...base, mode: "text", expectedLessonRevision: 2, positionMs: undefined, paragraphId: "t1:paragraph:1", contentId: "t1", contentVersion: lessonBookmarkContext(course, PREVIEW_LP, "text").contentVersion, clientEventId: "text-1" });
    assert.equal(text.lpNumber, "1.1");
    const saved = (await store.getLessonBookmarks(user.id, COURSE_ID)).bookmarks[PREVIEW_LP];
    assert.equal(saved.video?.positionMs, 100); assert.equal(saved.text?.paragraphId, "t1:paragraph:1");
    assert.ok(saved.text!.updatedAt > saved.video!.updatedAt);
    assert.equal(latestLessonBookmark({ [PREVIEW_LP]: saved }, PREVIEW_LP, { video: base.contentVersion, text: 'changed' })?.mode, 'video');
    assert.equal(latestLessonBookmark({ [PREVIEW_LP]: saved }, PREVIEW_LP, { video: 'deleted', text: 'changed' }), undefined);
    await assert.rejects(store.saveLessonBookmark(other.id, base), /forbidden/);
    await assert.rejects(store.saveLessonBookmark(user.id, { ...base, lessonId: PRIVATE_LP }), /mode_unavailable|content_changed|invalid_content/);
    await assert.rejects(store.saveLessonBookmark(user.id, { ...base, expectedRevision: 2, contentVersion: "old", clientEventId: "old-content" }), /content_changed/);
    await store.recordStudyEvent({ userId: user.id, courseId: COURSE_ID, lessonId: PREVIEW_LP, event: "complete", seconds: 0, clientEventId: "complete" });
    assert.deepEqual((await store.getLessonBookmarks(user.id, COURSE_ID)).bookmarks[PREVIEW_LP], saved);
    const expired = await readProductData();
    expired.entitlements.filter((item: { userId: string }) => item.userId === user.id).forEach((item: { validTo: string }) => { item.validTo = "2000-01-01"; });
    await writeProductData(expired);
    await assert.rejects(store.saveLessonBookmark(user.id, { ...base, expectedRevision: 2 }), /forbidden/);
  } finally { await restore(); }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { courseModePosition } from "../../lib/courseModePosition";
import { courseKnowledgePoints } from "../../lib/knowledgeProgress";
import { modeLessonDestination } from "../../lib/courseLearningMode";
import type { ProductCourse, ProductStudyEvent, ProductStudyRecord } from "../../services/productStore";

const course = { id: "course", sections: [{ lessons: ["a", "b", "c"].map(id => ({ id, contents: ["text", "video"].flatMap(type => [1, 2, 3, 4].map(n => ({ id: `${id}-${type}-${n}`, type }))) })) }] } as ProductCourse;
const event = (lessonId: string, contentId: string, learningMode: "text" | "video", extra: Partial<ProductStudyEvent> = {}) => ({
  id: contentId, userId: "user", courseId: course.id, lessonId, contentId, learningMode, event: "open", seconds: 0, clientEventId: contentId, createdAt: "2026-10-30T00:00:00Z", ...extra,
}) as ProductStudyEvent;
const resolve = (events: ProductStudyEvent[], extra: Partial<Parameters<typeof courseModePosition>[0]> = {}) => courseModePosition({
  course, mode: "text", userId: "user", events, fallbackLessonId: "a", accessiblePoints: courseKnowledgePoints(course, "text"), ...extra,
});

test("mode resume follows the last cursor at 1.3 even when its course maximum is 2.4", () => {
  const events = [event("b", "b-text-4", "text"), event("a", "a-text-3", "text", { createdAt: "2026-10-30T00:01:00Z" }), event("c", "c-video-3", "video")];
  const record = { userId: "user", courseId: course.id, knowledgePositions: { text: { lessonId: "a", contentId: "a-text-3" } }, highestProgress: { mode: "text", lessonId: "b", contentId: "b-text-4", progress: 67 } } as ProductStudyRecord;
  const before = structuredClone({ events, record });
  assert.deepEqual(resolve(events, { record }), { lessonId: "a", contentId: "a-text-3" });
  assert.deepEqual(resolve(events, { mode: "video", record, accessiblePoints: courseKnowledgePoints(course, "video") }), { lessonId: "c", contentId: "c-video-3" });
  assert.deepEqual({ events, record }, before);
  assert.deepEqual(resolve([...events].reverse(), { record }), { lessonId: "a", contentId: "a-text-3" });
});

test("completion does not override a later review cursor or the other mode's saved position", () => {
  const completion = event("b", "b-text-4", "text", { event: "complete", completeLesson: true });
  assert.equal(resolve([completion])?.contentId, "b-text-4");
  const review = event("a", "a-text-3", "text", { createdAt: "2026-10-30T00:01:00Z" });
  assert.equal(resolve([completion, review])?.contentId, "a-text-3");
  assert.equal(resolve([completion, review, event("a", "a-video-4", "video", { event: "complete", completeLesson: true, createdAt: "2026-10-30T00:02:00Z" })])?.contentId, "a-text-3");
  const sameLessonReview = event("b", "b-text-1", "text", { createdAt: "2026-10-30T00:01:00Z" });
  assert.equal(resolve([completion, sameLessonReview])?.contentId, "b-text-1", "an already completed Lesson still resumes the user's last reviewed point");
});

test("legacy event recovery chooses the latest server timestamp and append order, never the greatest outline index", () => {
  const far = event("b", "b-text-4", "text");
  const recent = event("a", "a-text-3", "text", { createdAt: "2026-10-30T00:01:00Z" });
  assert.equal(resolve([far, recent])?.contentId, "a-text-3");
  assert.equal(resolve([recent, far])?.contentId, "a-text-3");
  assert.equal(resolve([recent, { ...far, createdAt: recent.createdAt }])?.contentId, "b-text-4");
  assert.equal(resolve([recent, { ...far, createdAt: "invalid" }])?.contentId, "a-text-3");
});

test("legacy cursor/provenance, no-history fallback and unavailable points remain bounded by access", () => {
  const record = { userId: "user", courseId: course.id, knowledgePositions: { text: { lessonId: "b", contentId: "b-text-2" } } } as ProductStudyRecord;
  assert.equal(resolve([], { record })?.contentId, "b-text-2");
  assert.equal(resolve([], { record: { ...record, highestProgress: { lessonId: "c", contentId: "c-text-1", mode: "text", progress: 78 } } })?.contentId, "b-text-2");
  assert.equal(resolve([], { record: { ...record, knowledgePositions: undefined, highestProgress: { lessonId: "c", contentId: "c-text-1", mode: "text", progress: 78 } } })?.contentId, "a-text-1");
  assert.equal(resolve([], { fallbackLessonId: "b" })?.contentId, "b-text-1");
  assert.equal(resolve([], { fallbackLessonId: "missing" })?.contentId, "a-text-1");
  assert.equal(resolve([], { accessiblePoints: [] }), null);
  const bad = [event("c", "c-text-3", "text", { userId: "other" }), event("c", "c-text-3", "text", { courseId: "other" }), event("c", "deleted", "text"), event("b", "c-text-3", "text")];
  assert.equal(resolve(bad, { record: { ...record, userId: "other" } })?.contentId, "a-text-1");
  const preview = courseKnowledgePoints(course, "text").filter(point => point.lessonId === "a" && ["a-text-1", "a-text-2"].includes(point.contentId || ""));
  assert.equal(resolve([event("c", "c-text-3", "text")], { record, accessiblePoints: preview })?.contentId, "a-text-1");
  assert.equal(resolve([event("a", "a-video-4", "video", { event: "complete", completeLesson: true })], { accessiblePoints: preview })?.contentId, "a-text-1", "another mode's completion cannot substitute a cursor");
  const edited = structuredClone(course); edited.sections[0].lessons[2].contents!.find(point => point.id === "c-text-3")!.active = false;
  assert.equal(resolve([event("c", "c-text-3", "text")], { course: edited })?.contentId, "a-text-1");
});

test("mode navigation uses the returned Course-wide position while excluding locked destinations", () => {
  const outline = ["a", "b"].map(id => ({ id, href: `/zh-CN/account/learn/course?lessonId=${id}&keep=1`, modes: ["text", "video"] as ("text" | "video")[] }));
  assert.deepEqual(modeLessonDestination(outline, "a", "text", true, "a-text-1", { lessonId: "b", contentId: "b-text-2" }), {
    lessonId: "b", href: "/zh-CN/account/learn/course?lessonId=b&keep=1&viewMode=text&contentId=b-text-2",
  });
  assert.equal(modeLessonDestination([...outline, { id: "locked", href: null, modes: ["text"] }], "a", "text", true, "a-text-1", { lessonId: "locked", contentId: "secret" })?.lessonId, "a");
  assert.equal(modeLessonDestination(outline, "a", "text", true, "a-text-1", null), null, "an explicitly unavailable server target cannot fall back to stale client metadata");
});

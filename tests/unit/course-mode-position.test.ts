import assert from "node:assert/strict";
import { test } from "node:test";
import { courseModePosition } from "../../lib/courseModePosition";
import { courseKnowledgePoints } from "../../lib/knowledgeProgress";
import { modeLessonDestination } from "../../lib/courseLearningMode";
import type { ProductCourse, ProductStudyEvent, ProductStudyRecord } from "../../services/productStore";

const course = { id: "course", sections: [{ lessons: ["a", "b", "c"].map(id => ({ id, contents: ["text", "video"].flatMap(type => [1, 2, 3].map(n => ({ id: `${id}-${type}-${n}`, type }))) })) }] } as ProductCourse;
const event = (lessonId: string, contentId: string, learningMode: "text" | "video", extra: Partial<ProductStudyEvent> = {}) => ({
  id: contentId, userId: "user", courseId: course.id, lessonId, contentId, learningMode, event: "open", seconds: 0, clientEventId: contentId, createdAt: "2026-10-30T00:00:00Z", ...extra,
}) as ProductStudyEvent;
const resolve = (events: ProductStudyEvent[], extra: Partial<Parameters<typeof courseModePosition>[0]> = {}) => courseModePosition({
  course, mode: "text", userId: "user", events, fallbackLessonId: "a", accessiblePoints: courseKnowledgePoints(course, "text"), ...extra,
});

test("mode maximum follows full outline order independently of review cursor and other-mode history", () => {
  const events = [event("b", "b-text-2", "text"), event("a", "a-text-1", "text"), event("c", "c-video-3", "video")];
  const record = { userId: "user", courseId: course.id, knowledgePositions: { text: { lessonId: "a", contentId: "a-text-1" } }, highestProgress: { mode: "video", lessonId: "c", contentId: "c-video-3", progress: 100 } } as ProductStudyRecord;
  const before = structuredClone({ events, record });
  assert.deepEqual(resolve(events, { record }), { lessonId: "b", contentId: "b-text-2" });
  assert.deepEqual(resolve(events, { mode: "video", record, accessiblePoints: courseKnowledgePoints(course, "video") }), { lessonId: "c", contentId: "c-video-3" });
  assert.deepEqual({ events, record }, before);
  assert.deepEqual(resolve([...events].reverse(), { record }), { lessonId: "b", contentId: "b-text-2" });
});

test("completed destination lessons select the final requested-mode point without marking other modes complete", () => {
  const history = [event("b", "b-text-2", "text")];
  const partial = event("b", "b-video-1", "video", { event: "complete" });
  assert.equal(resolve([...history, partial])?.contentId, "b-text-2", "a single completed sibling point is not whole-Lesson completion");
  assert.equal(resolve([...history, event("b", "b-video-3", "video", { event: "complete", completeLesson: true })])?.contentId, "b-text-3");
  assert.equal(resolve([...history, ...[1, 2, 3].map(n => event("b", `b-video-${n}`, "video", { event: "complete" }))])?.contentId, "b-text-3");
  assert.equal(resolve([...history, event("c", "c-video-3", "video", { event: "complete", completeLesson: true })])?.contentId, "b-text-2", "another mode's later completed Lesson cannot advance this mode's maximum");
  const legacy = { ...event("a", "", "text", { event: "complete" }), learningMode: undefined, contentId: undefined };
  assert.equal(resolve([legacy])?.contentId, "a-text-3");
});

test("legacy cursor/provenance, no-history fallback and unavailable points remain bounded by access", () => {
  const record = { userId: "user", courseId: course.id, knowledgePositions: { text: { lessonId: "b", contentId: "b-text-2" } } } as ProductStudyRecord;
  assert.equal(resolve([], { record })?.contentId, "b-text-2");
  assert.equal(resolve([], { record: { ...record, highestProgress: { lessonId: "c", contentId: "c-text-1", mode: "text", progress: 78 } } })?.contentId, "c-text-1");
  assert.equal(resolve([], { fallbackLessonId: "b" })?.contentId, "b-text-1");
  assert.equal(resolve([], { fallbackLessonId: "missing" })?.contentId, "a-text-1");
  assert.equal(resolve([], { accessiblePoints: [] }), null);
  const bad = [event("c", "c-text-3", "text", { userId: "other" }), event("c", "c-text-3", "text", { courseId: "other" }), event("c", "deleted", "text"), event("b", "c-text-3", "text")];
  assert.equal(resolve(bad, { record: { ...record, userId: "other" } })?.contentId, "a-text-1");
  const preview = courseKnowledgePoints(course, "text").filter(point => point.lessonId === "a" && point.contentId !== "a-text-3");
  assert.equal(resolve([event("c", "c-text-3", "text")], { record, accessiblePoints: preview })?.contentId, "a-text-1");
  assert.equal(resolve([event("a", "a-video-3", "video", { event: "complete", completeLesson: true })], { accessiblePoints: preview })?.contentId, "a-text-2", "completion never selects a locked preview point");
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

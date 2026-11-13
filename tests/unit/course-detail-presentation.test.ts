import assert from "node:assert/strict";
import { test } from "node:test";
import { courseCategoryPlan, courseDurationParts, courseLessonDuration, coursePrimaryLessonId } from "../../lib/courseDetailPresentation";
import type { CourseSyllabusItem } from "../../lib/coursePage";
import type { ProductPlan } from "../../services/productStore";
import en from "../../messages/en-GB.json";
import zh from "../../messages/zh-CN.json";

test("curriculum highlights the current unfinished Lesson or the first available unfinished Lesson", () => {
  const syllabus: CourseSyllabusItem[] = Array.from({ length: 5 }, (_, index) => ({
    lessonId: String(index + 1), title: `Lesson ${index + 1}`, access: "entitled", openable: true,
  }));
  const page = { syllabus, actionLessonId: "1" };
  assert.equal(coursePrimaryLessonId(page), "1");
  syllabus[0].completed = true;
  assert.equal(coursePrimaryLessonId(page), "2");
  syllabus[2].completed = syllabus[4].completed = true;
  page.actionLessonId = "5";
  assert.equal(coursePrimaryLessonId(page), "2", "completed 1/3/5 leaves Lesson 2 as the next Start");
  syllabus[3].continuable = true;
  assert.equal(coursePrimaryLessonId(page), "4", "an unfinished checkpoint takes priority over a new Lesson");
  page.actionLessonId = "2";
  assert.equal(coursePrimaryLessonId(page), "2", "the current unfinished Lesson keeps its highlight");
  for (const lesson of syllabus) lesson.completed = true;
  assert.equal(coursePrimaryLessonId(page), "1", "all-complete keeps the first Review prominent");
  for (const lesson of syllabus) lesson.access = "locked";
  assert.equal(coursePrimaryLessonId(page), null);
  assert.equal(coursePrimaryLessonId({ syllabus: [], actionLessonId: null }), null);
});

test("course detail shows real video duration or the lesson's configured minutes", () => {
  assert.equal(courseLessonDuration({ durationMinutes: 33, videoDurationSeconds: 1941 }), "32:21");
  assert.equal(courseLessonDuration({ durationMinutes: 25 }), "25:00");
  assert.equal(courseLessonDuration({ durationMinutes: 1.5, videoDurationSeconds: null }), "1:30");
  assert.equal(courseLessonDuration({ durationMinutes: 25, videoDurationSeconds: 0 }), "0:00");
  assert.equal(courseLessonDuration(), "—");
});

test("course detail splits total duration into whole hours and minutes", () => {
  assert.deepEqual(courseDurationParts(0), { hours: 0, minutes: 0 });
  assert.deepEqual(courseDurationParts(60), { hours: 1, minutes: 0 });
  assert.deepEqual(courseDurationParts(125), { hours: 2, minutes: 5 });
  assert.deepEqual(courseDurationParts(61.4), { hours: 1, minutes: 1 });
  assert.deepEqual(courseDurationParts(-1), { hours: 0, minutes: 0 });
});

test("category card selects the trusted available six-month desktop category plan", () => {
  const matching: ProductPlan = { id: "science-pc-6", name: "Science", courseId: "*", scope: "category", scopeId: "Science", device: "pc", termMonths: 6, amountMinor: 4900, currency: "usd", available: true };
  const plans: ProductPlan[] = [
    { ...matching, id: "unavailable", available: false },
    { ...matching, id: "year", termMonths: 12 },
    { ...matching, id: "mobile", device: "mobile" },
    { ...matching, id: "different", scopeId: "Chinese Humanities" },
    { ...matching, id: "everything", scope: "everything" },
    matching,
  ];
  assert.equal(courseCategoryPlan(plans, "Science"), matching);
  assert.equal(courseCategoryPlan(plans, "Science")?.amountMinor, 4900);
  assert.equal(courseCategoryPlan(plans, "European Humanities"), undefined);
  assert.equal(courseCategoryPlan([{ ...matching, available: false }], "Science"), undefined);
  assert.equal(courseCategoryPlan([{ ...matching, scopeId: null, category: "Science" }], "Science")?.id, matching.id);
});

test("course detail fixed copy follows Figma with matching locale keys", () => {
  assert.deepEqual(Object.keys(en.courseDetailDesign), Object.keys(zh.courseDetailDesign));
  assert.equal(en.courseDetailDesign.overview, "Overview");
  assert.equal(en.courseDetailDesign.curriculum, "Course Curriculum");
  assert.equal(en.courseDetailDesign.outcomes.length, 6);
  assert.equal(en.courseDetailDesign.features.length, 6);
  assert.equal(en.courseDetailDesign.outcomes[4], "Explore dynamics across disciplines");
  assert.equal(en.courseDetailDesign.outcomes[5], "Build the competencies future physicians and researchers need");
});

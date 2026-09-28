import assert from "node:assert/strict";
import { test } from "node:test";
import { courseCategoryPlan, courseLessonDuration } from "../../lib/courseDetailPresentation";
import type { ProductPlan } from "../../services/productStore";
import en from "../../messages/en-GB.json";
import zh from "../../messages/zh-CN.json";

test("course detail shows real video duration or the lesson's configured minutes", () => {
  assert.equal(courseLessonDuration({ durationMinutes: 33, videoDurationSeconds: 1941 }), "32:21");
  assert.equal(courseLessonDuration({ durationMinutes: 25 }), "25:00");
  assert.equal(courseLessonDuration({ durationMinutes: 1.5, videoDurationSeconds: null }), "1:30");
  assert.equal(courseLessonDuration({ durationMinutes: 25, videoDurationSeconds: 0 }), "0:00");
  assert.equal(courseLessonDuration(), "—");
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

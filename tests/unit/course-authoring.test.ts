import assert from "node:assert/strict";
import { test } from "node:test";
import { applyCourseDraft, AuthoringError } from "../../services/courseAuthoring";
import type { ProductCourse } from "../../services/productStore";
const course: ProductCourse = { id: "c1", slug: "same-slug", title: "Original", description: "", status: "draft", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", sections: [{ id: "s1", title: "One", lessons: [{ id: "l1", title: "Lesson", body: "Text", durationMinutes: 20, isPublic: false }] }] };
const input = () => ({ title: "Updated", description: "Updated description", expectedUpdatedAt: course.updatedAt, sections: structuredClone(course.sections) });
test("authoring edits and reorders without changing existing course/lesson IDs", () => {
  const draft = input();
  draft.sections.unshift({ id: "new-section", title: "Two", lessons: draft.sections[0].lessons.splice(0) });
  const result = applyCourseDraft(course, draft);
  assert.equal(result.id, course.id); assert.equal(result.slug, course.slug);
  assert.equal(result.sections[0].lessons[0].id, "l1");
  assert.match(result.sections[0].id, /^section_/);
  assert.equal(course.title, "Original");
  assert.notEqual(result.updatedAt, course.updatedAt);
});
test("published and stale edits are rejected", () => {
  assert.throws(() => applyCourseDraft({ ...course, status: "published" }, input()), (e: unknown) => e instanceof AuthoringError && e.code === "published");
  assert.throws(() => applyCourseDraft(course, { ...input(), expectedUpdatedAt: "old" }), (e: unknown) => e instanceof AuthoringError && e.code === "conflict");
});
test("rejects deleted, duplicate and foreign IDs, invalid durations and multiple public lessons", () => {
  for (const mutate of [
    (d: ReturnType<typeof input>) => { d.sections = []; },
    (d: ReturnType<typeof input>) => { d.sections[0].lessons.push(d.sections[0].lessons[0]); },
    (d: ReturnType<typeof input>) => { d.sections[0].id = "foreign"; },
    (d: ReturnType<typeof input>) => { d.sections[0].lessons[0].durationMinutes = NaN; },
    (d: ReturnType<typeof input>) => { d.sections[0].lessons[0].isPublic = true; d.sections[0].lessons.push({ ...d.sections[0].lessons[0], id: "new-second" }); },
  ]) { const draft = input(); mutate(draft); assert.throws(() => applyCourseDraft(course, draft), AuthoringError); }
});

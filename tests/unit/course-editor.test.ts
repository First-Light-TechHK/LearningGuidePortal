import assert from "node:assert/strict";
import { test } from "node:test";
import { courseEditorGate, resolveOutlineSelection } from "../../lib/courseEditor";

test("published and archived courses must be returned to draft before the editor opens", () => {
  assert.equal(courseEditorGate("draft"), "open");
  assert.equal(courseEditorGate("published"), "unpublish");
  assert.equal(courseEditorGate("archived"), "restore");
});

test("the content outline keeps a valid section and lesson selected", () => {
  const sections = [
    { id: "s1", lessons: [{ id: "l1" }, { id: "l2" }] },
    { id: "s2", lessons: [] }
  ];
  assert.deepEqual(resolveOutlineSelection(sections, null), { sectionId: "s1", lessonId: "l1" });
  assert.deepEqual(resolveOutlineSelection(sections, { sectionId: "s1", lessonId: "l2" }), { sectionId: "s1", lessonId: "l2" });
  assert.deepEqual(resolveOutlineSelection(sections, { sectionId: "missing", lessonId: "l2" }), { sectionId: "s1", lessonId: "l1" });
  assert.deepEqual(resolveOutlineSelection(sections, { sectionId: "s2", lessonId: null }), { sectionId: "s2", lessonId: null });
});

test("an empty course has no outline selection until a section exists", () => {
  assert.equal(resolveOutlineSelection([], null), null);
});

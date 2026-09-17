import assert from "node:assert/strict";
import { test } from "node:test";
import { applyCourseDraft, selectAuthorCourses, validateCourseMetadata } from "../../services/courseAuthoring";
import type { ProductCourse, ProductUser } from "../../services/productStore";
import type { CourseDraftInput, CourseMetadata } from "../../contracts/course-authoring";

const timestamp = "2026-01-01T00:00:00.000Z";
const teacher: ProductUser = { id: "teacher-1", role: "teacher", status: "active", email: "teacher@example.test", emailVerifiedAt: timestamp, passwordHash: null, nickname: "Teacher", locale: "en-GB", createdAt: timestamp };
const course: ProductCourse = { id: "course-1", slug: "course-one", title: "Course one", description: "Description", category: "Science", authorIds: [teacher.id], status: "draft", createdAt: timestamp, updatedAt: timestamp, sections: [{ id: "section-1", title: "Section one", lessons: [{ id: "lesson-1", title: "First lesson", body: "Legacy text", durationMinutes: 10, isPublic: false }] }] };
const input = (): CourseDraftInput => ({ expectedUpdatedAt: timestamp, title: course.title, description: course.description, sections: structuredClone(course.sections) });

test("metadata is validated and round-trips without changing billing, ownership or identity", () => {
  const metadata: CourseMetadata = { subtitle: " Subtitle ", level: "advanced", tags: ["Algebra", "Algebra", " Logic "], categoryId: "category-1", subjectId: "subject-1", referencePrice: 42.5, discount: 12.5, cover: "/api/course-media/course-1/11111111-1111-4111-8111-111111111111" };
  const next = applyCourseDraft(course, { ...input(), ...metadata });
  assert.equal(next.subtitle, "Subtitle");
  assert.deepEqual(next.tags, ["Algebra", "Logic"]);
  assert.equal(next.referencePrice, 42.5);
  assert.equal(next.discount, 12.5);
  for (const key of ["id", "slug", "category", "authorIds", "createdAt"] as const) assert.deepEqual(next[key], course[key]);
  for (const invalid of [{ level: "expert" }, { discount: 101 }, { referencePrice: -1 }, { referencePrice: 0.001 }, { discount: NaN }, { cover: "javascript:alert(1)" }, { cover: "//example.test/image" }, { cover: "https://example.test/cover.png" }, { tags: [23] }, { subjectId: {} }] as unknown as CourseMetadata[]) assert.throws(() => validateCourseMetadata(invalid, course.id), { code: "invalid" });
  assert.throws(() => validateCourseMetadata({ cover: "/api/course-media/other/11111111-1111-4111-8111-111111111111" }, course.id), { code: "invalid" });
});

test("explicit removal archives exact historical content while implicit and forged removals fail", () => {
  const next = applyCourseDraft(course, { ...input(), sections: [], removedSectionIds: ["section-1"] });
  assert.equal(next.sections.length, 0);
  assert.deepEqual(next.archivedSections![0].lessons, course.sections[0].lessons);
  assert.equal(next.archivedSections![0].id, "section-1");
  assert.ok(next.archivedSections![0].archivedAt);
  assert.equal(course.sections.length, 1);
  assert.throws(() => applyCourseDraft(course, { ...input(), sections: [] }), { code: "invalid" });
  assert.throws(() => applyCourseDraft(course, { ...input(), sections: [], removedSectionIds: ["foreign"] }), { code: "invalid" });
  assert.throws(() => applyCourseDraft(course, { ...input(), removedLessonIds: ["lesson-1"] }), { code: "invalid" });
});

test("moving lessons out of a removed section archives no duplicate live lessons", () => {
  const draft = input();
  draft.sections = [{ id: "new-section", title: "Replacement", lessons: draft.sections[0].lessons }];
  draft.removedSectionIds = ["section-1"];
  const next = applyCourseDraft(course, draft);
  assert.equal(next.sections[0].lessons[0].id, "lesson-1");
  assert.equal(next.archivedSections![0].lessons.length, 0);
});

test("legacy draft payloads preserve rich content; explicit rich removal clears content without plaintext resurrection", () => {
  const rich = structuredClone(course);
  rich.sections[0].lessons[0].contents = [{ id: "content-1", title: "Structured", type: "text", mode: "lecture", html: "<p>Rich <strong>algebra</strong></p>", nodes: [] }];
  const saved = applyCourseDraft(rich, input());
  assert.deepEqual(saved.sections[0].lessons[0].contents, rich.sections[0].lessons[0].contents);
  assert.match(saved.sections[0].lessons[0].body, /algebra/);
  const draft = input(); draft.sections[0].lessons[0].contents = []; draft.sections[0].lessons[0].body = "";
  assert.equal(applyCourseDraft(rich, draft).sections[0].lessons[0].body, "");
});

test("catalogue search filters the entire owned collection before pagination", () => {
  const courses: ProductCourse[] = Array.from({ length: 27 }, (_, index) => ({ ...course, id: "course-" + index, title: "Course " + index, categoryId: "category-1", subjectId: index % 2 ? "subject-1" : "subject-2", level: "beginner", tags: index === 25 ? ["Needle"] : [], authorIds: index === 26 ? ["foreign"] : [teacher.id] }));
  const first = selectAuthorCourses(courses, teacher, { pageSize: 10, page: 1 });
  assert.equal(first.total, 26); assert.equal(first.pages, 3); assert.equal(first.courses.length, 10);
  const searched = selectAuthorCourses(courses, teacher, { search: "needle", page: 3 });
  assert.equal(searched.total, 1); assert.equal(searched.page, 1); assert.equal(searched.courses[0].id, "course-25");
  assert.equal(selectAuthorCourses(courses, teacher, { categoryId: "category-1", subjectId: "subject-1", level: "beginner" }).total, 13);
  assert.equal(selectAuthorCourses([{ ...course, status: "archived" }], teacher).total, 0);
  assert.equal(selectAuthorCourses([{ ...course, status: "archived" }], teacher, { status: "all" }).total, 1);
  assert.throws(() => selectAuthorCourses(courses, teacher, { pageSize: 0 }), { code: "invalid" });
  assert.throws(() => selectAuthorCourses(courses, teacher, { page: NaN }), { code: "invalid" });
});

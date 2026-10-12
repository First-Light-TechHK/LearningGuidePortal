import assert from "node:assert/strict";
import { test, before, after } from "node:test";
let sampleLearningOverview: typeof import("../../services/learningOverviewDisplay").sampleLearningOverview;
import type { ProductCourse } from "../../services/productStore";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const originalCwd = process.cwd(), backend = process.env.STORAGE_BACKEND;
let isolated: string;
before(async () => {
  isolated = await mkdtemp(path.join(tmpdir(), "lg-overview-display-"));
  process.chdir(isolated); process.env.STORAGE_BACKEND = "local";
  ({ sampleLearningOverview } = await import("../../services/learningOverviewDisplay"));
});
after(async () => {
  process.chdir(originalCwd);
  if (backend === undefined) delete process.env.STORAGE_BACKEND; else process.env.STORAGE_BACKEND = backend;
  if (isolated && path.dirname(isolated) === tmpdir()) await rm(isolated, { recursive: true, force: true });
});

const course = (id: string, status: ProductCourse["status"] = "published"): ProductCourse => ({
  id, slug: id, title: id, description: "Course", category: "Science", status,
  createdAt: "2026-10-10T00:00:00.000Z", updatedAt: "2026-10-10T00:00:00.000Z",
  sections: [{ id: "section", title: "Section", lessons: Array.from({ length: 8 }, (_, index) => ({ id: `lesson-${index + 1}`, title: `Lesson ${index + 1}`, body: "Body", durationMinutes: 10, isPublic: index === 0 })) }],
});
test("all published courses appear independently in both sample lists; preview has no progress", () => {
  const courses = [course("a"), course("b"), course("c"), course("draft", "draft"), course("archived", "archived")];
  const before = structuredClone(courses);
  const display = sampleLearningOverview(courses);
  assert.deepEqual(display.learning.map(item => item.courseId), ["a", "b", "c"]);
  assert.deepEqual(display.previewed.map(item => item.courseId), ["a", "b", "c"]);
  assert.deepEqual(display.learning.map(item => item.progress), [46, 100, 25]);
  assert.equal(display.learning[0].currentLesson, 4);
  assert.equal(display.learning[1].currentLesson, null);
  assert.equal(display.previewed.some(item => "progress" in item), false);
  assert.deepEqual(courses, before, "sample data must never mutate the catalogue");
});
test("empty courses and missing lessons produce a valid presentation", () => {
  assert.deepEqual(sampleLearningOverview([]), { learning: [], previewed: [] });
  const empty = { ...course("empty"), sections: [] };
  assert.equal(sampleLearningOverview([empty]).learning[0].currentLessonId, null);
});

test("Overview catalogue service reads all published courses without persisting sample progress", async () => {
    const { listPublishedCourses } = await import("../../services/productStore");
    const { getLearningOverviewDisplay } = await import("../../services/learningOverviewDisplay");
    const seededCourses = await listPublishedCourses();
    const file = path.join(isolated, "data", "knowledge_system", "learning_guide", "product.json");
    const fixture = JSON.parse(await readFile(file, "utf8"));
    fixture.courses = seededCourses;
    // This local fixture tests persistence, without requiring live S3 credentials.
    fixture.courses.forEach((course: ProductCourse) => { course.cover = "/portal/course-book.jpg"; course.thumbnailPath = "/portal/course-book.jpg"; });
    await writeFile(file, JSON.stringify(fixture));
    const courses = await listPublishedCourses();
    const before = await readFile(file, "utf8");
    const display = await getLearningOverviewDisplay("unstarted-test-user");
    assert.deepEqual(display.learning.map(item => item.courseId), courses.map(item => item.id));
    assert.deepEqual(display.previewed.map(item => item.courseId), courses.map(item => item.id));
    assert.ok(display.learning.every(item => item.progress === 0), "unstarted courses never use sample percentages");
    const after=JSON.parse(await readFile(file,"utf8")), prior=JSON.parse(before);
    assert.deepEqual(after.studyRecords,prior.studyRecords,"display must not change study positions");
    assert.deepEqual(after.studyEvents,prior.studyEvents,"display must not invent study events");
});

import type { ProductCourse } from "../../services/productStore";
import type { MigrationOrm } from "../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "./types";

export const id = "005_backfill_lesson_summaries";
export const description = "Fill the confirmed public introduction for the first Horace lesson when absent.";
export const touches = ["courses"] as const;

// Explicit reviewed metadata only. Never extract introductions from protected bodies.
const summaries = [{ courseId: "quintus-horatius-flaccus", lessonId: "horatius-lesson-21", summary: "The legendary life of Horace from soldier to poet laureate" }];

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const courses = orm.table<ProductCourse>("courses");
  return summaries.map(({ courseId, lessonId, summary }) => {
    const course = courses.findById(courseId);
    const lesson = course?.sections.flatMap(section => section.lessons).find(item => item.id === lessonId);
    if (!course || !lesson) return { action: "skip", kind: "lesson", id: lessonId, reason: "missing" };
    if (lesson.summary?.trim()) return { action: "skip", kind: "lesson", id: lessonId, reason: "summary-exists" };
    courses.update(courseId, {
      updatedAt: new Date(Math.max(Date.parse(ctx.now), Date.parse(course.updatedAt) + 1)).toISOString(),
      sections: course.sections.map(section => ({ ...section, lessons: section.lessons.map(item => item.id === lessonId ? { ...item, summary } : item) })),
    });
    return { action: "update", kind: "lesson", id: lessonId };
  });
}

import type { ProductCourse } from "../../services/productStore";
import type { MigrationOrm } from "../../services/migrationOrm";
import { modelingLifeCourse } from "./008_upgrade_modeling_life";
import type { DataChange, DataMigrationContext } from "./types";

export const id = "009_fix_modeling_life_exhibits";
export const description = "Keep only the two confirmed Lesson 1 exhibits in Modeling life Exploration.";
export const touches = ["courses"] as const;

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const courses = orm.table<ProductCourse>("courses"), course = courses.findById("modeling-life");
  const lessonId = "modeling-life-lesson-1";
  const lesson = course?.sections.flatMap(section => section.lessons).find(item => item.id === lessonId);
  if (!course || course.slug !== "modeling-life" || !lesson?.exploration) return [{ action: "skip", kind: "lesson", id: lessonId, reason: "missing" }];
  const exhibits = modelingLifeCourse(ctx.now).sections[0].lessons[0].exploration!.exhibits;
  if (JSON.stringify(lesson.exploration.exhibits) === JSON.stringify(exhibits)) return [{ action: "skip", kind: "lesson", id: lessonId, reason: "exhibits-current" }];
  courses.update(course.id, {
    updatedAt: new Date(Math.max(Date.parse(ctx.now), Date.parse(course.updatedAt) + 1)).toISOString(),
    sections: course.sections.map(section => ({ ...section, lessons: section.lessons.map(item => item.id === lessonId ? { ...item, exploration: { ...item.exploration!, exhibits } } : item) })),
  });
  return [{ action: "update", kind: "lesson", id: lessonId }];
}

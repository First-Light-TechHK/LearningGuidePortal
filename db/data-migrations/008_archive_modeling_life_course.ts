import type { ProductCourse } from "../../services/productStore";
import type { MigrationOrm } from "../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "./types";

export const id = "008_archive_modeling_life_course";
export const description = "Archive the Modeling life draft left by the reverted media migration.";
export const touches = ["courses"] as const;

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const courses = orm.table<ProductCourse>("courses");
  const course = courses.findById("modeling-life");
  if (!course) return [{ action: "skip", kind: "course", id: "modeling-life", reason: "absent" }];
  courses.update(course.id, { ...course, status: "archived", updatedAt: ctx.now });
  return [{ action: "update", kind: "course", id: "modeling-life" }];
}

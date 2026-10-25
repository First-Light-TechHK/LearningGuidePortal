import type { MigrationOrm } from "../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "./types";
import { modelingLifeCourse } from "./006_add_modeling_life_course";
import type { ProductCourse } from "../../services/productStore";

export const id = "007_repair_modeling_life_media";
export const description = "Keep the Modeling life course record without copying media bytes.";
export const touches = ["courses"] as const;

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const courses = orm.table<ProductCourse>("courses");
  const next = modelingLifeCourse(ctx.now);
  const existing = courses.findById(next.id);
  if (!existing) {
    courses.insert(next);
    return [{ action: "add", kind: "course", id: next.id }];
  }
  return [{ action: "skip", kind: "course", id: next.id, reason: "exists" }];
}

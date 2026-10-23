import type { MigrationOrm } from "../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "./types";
import { modelingLifeCourse, syncModelingLifeMedia } from "./006_add_modeling_life_course";
import type { ProductCourse } from "../../services/productStore";

export const id = "007_repair_modeling_life_media";
export const description = "Copy Modeling life media into course_media after the runtime role was granted access.";
export const touches = ["courses", "media"] as const;

export async function apply(orm: MigrationOrm, ctx: DataMigrationContext): Promise<DataChange[]> {
  const changes: DataChange[] = [];
  // This migration exists to retry the media copy after an IAM fix. A staging
  // or credentials problem must not block boot or the course itself; record the
  // skip and let the next run retry.
  try {
    changes.push(...await syncModelingLifeMedia());
  } catch (error) {
    changes.push({ action: "skip", kind: "course-media", id: "modeling-life", reason: error instanceof Error ? error.message : "staging-missing" });
  }
  const courses = orm.table<ProductCourse>("courses");
  const next = modelingLifeCourse(ctx.now);
  const existing = courses.findById(next.id);
  if (!existing) {
    courses.insert(next);
    changes.push({ action: "add", kind: "course", id: next.id });
    return changes;
  }
  courses.update(next.id, { ...existing, ...next, id: next.id, createdAt: existing.createdAt || ctx.now, updatedAt: ctx.now });
  changes.push({ action: "update", kind: "course", id: next.id });
  return changes;
}

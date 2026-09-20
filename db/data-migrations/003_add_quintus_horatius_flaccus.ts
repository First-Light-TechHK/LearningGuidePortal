import productSnapshot from "../../data/knowledge_system/learning_guide/product.json";
import type { ProductCourse } from "../../services/productStore";
import type { MigrationOrm } from "../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "./types";

export const id = "003_add_quintus_horatius_flaccus";
export const description = "Add the published Quintus Horatius Flaccus course from the catalogue snapshot.";
export const touches = ["courses"] as const;

const course = productSnapshot.courses.find((item) => item.title === "Quintus Horatius Flaccus") as unknown as ProductCourse | undefined;

export function apply(orm: MigrationOrm, _ctx: DataMigrationContext): DataChange[] {
  const courses = orm.table<ProductCourse>("courses");
  if (courses.find((item) => item.id === "quintus-horatius-flaccus" || item.slug === "quintus-horatius-flaccus").length) {
    return [{ action: "skip", kind: "course", id: "quintus-horatius-flaccus", reason: "exists" }];
  }
  if (!course) {
    return [{ action: "skip", kind: "course", id: "quintus-horatius-flaccus", reason: "missing-from-snapshot" }];
  }
  courses.insert(course);
  return [{ action: "add", kind: "course", id: course.id }];
}

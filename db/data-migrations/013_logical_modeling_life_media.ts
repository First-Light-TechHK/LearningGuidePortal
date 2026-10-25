import type { ProductCourse } from "../../services/productStore";
import type { MigrationOrm } from "../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "./types";

export const id = "013_logical_modeling_life_media";
export const description = "Keep Modeling life video and exhibit URLs as environment-neutral course-media ids.";
export const touches = ["courses"] as const;

const COURSE_ID = "modeling-life";
const MEDIA: Record<string, string> = {
  "lesson1.mp4": "/api/course-media/modeling-life/04f0039b-42c7-441b-85b7-fe6e21c6bbe6",
  "lesson2.mp4": "/api/course-media/modeling-life/613a07b1-24e8-4123-ab10-5bd36875293e",
  "lesson1-exhibit-1.png": "/api/course-media/modeling-life/9a88e350-e44f-47b1-9518-ed8b50cc4d36",
  "lesson1-exhibit-2.png": "/api/course-media/modeling-life/3d1a37f4-6535-450c-879a-22c3cad48b08",
  "lesson1-exhibit-1-s.png": "/api/course-media/modeling-life/1b00006f-08ed-4f77-8285-a4685e3237de",
  "lesson1-exhibit-2-s.png": "/api/course-media/modeling-life/1d1e5a63-48ef-47b9-aeaf-b4a41b065515",
};

function rewrite(value: string): string {
  if (!value || value.startsWith("/api/course-media/")) return value;
  const name = Object.keys(MEDIA).find((file) => value === MEDIA[file] || value.endsWith(`/${file}`) || value.endsWith(file));
  return name ? MEDIA[name] : value;
}

function rewriteUnknown(value: unknown): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    const next = rewrite(value);
    return { value: next, changed: next !== value };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = rewriteUnknown(item);
      changed ||= result.changed;
      return result.value;
    });
    return { value: next, changed };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const result = rewriteUnknown(item);
      changed ||= result.changed;
      next[key] = result.value;
    }
    return { value: next, changed };
  }
  return { value, changed: false };
}

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const courses = orm.table<ProductCourse>("courses");
  const course = courses.findById(COURSE_ID);
  if (!course) return [{ action: "skip", kind: "course", id: COURSE_ID, reason: "absent" }];
  const result = rewriteUnknown(course);
  if (!result.changed) return [{ action: "skip", kind: "course", id: COURSE_ID, reason: "already-logical" }];
  courses.update(COURSE_ID, { ...(result.value as ProductCourse), id: COURSE_ID, updatedAt: ctx.now });
  return [{ action: "update", kind: "course", id: COURSE_ID }];
}

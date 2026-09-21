import type { ProductCourse } from "../../services/productStore";
import type { MigrationOrm } from "../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "./types";

export const id = "004_migrate_mvp_media_to_aws";
export const description = "Replace legacy MVP COS media URLs in course data with the migrated AWS S3 URLs.";
export const touches = ["courses"] as const;

const LEGACY_PREFIX = "https://learningguide-1380131816.cos.ap-hongkong.myqcloud.com/mvp/";
const AWS_PREFIX = "https://aitutor-data-851987565851.s3.ap-southeast-1.amazonaws.com/learning-guide/dev/documents/mvp/";

function replaceUrls<T>(value: T): { value: T; changed: boolean } {
  if (typeof value === "string") {
    const replaced = value.split(LEGACY_PREFIX).join(AWS_PREFIX);
    return { value: replaced as T, changed: replaced !== value };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = replaceUrls(item);
      changed ||= result.changed;
      return result.value;
    });
    return { value: next as T, changed };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next = { ...(value as Record<string, unknown>) };
    for (const [key, item] of Object.entries(next)) {
      const result = replaceUrls(item);
      changed ||= result.changed;
      next[key] = result.value;
    }
    return { value: next as T, changed };
  }
  return { value, changed: false };
}

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const courses = orm.table<ProductCourse>("courses");
  const changes: DataChange[] = [];
  for (const course of courses.all()) {
    const result = replaceUrls(course);
    if (!result.changed) continue;
    courses.update(course.id, { ...result.value, updatedAt: ctx.now });
    changes.push({ action: "update", kind: "course-media-url", id: course.id });
  }
  return changes.length ? changes : [{ action: "skip", kind: "course-media-url", id: "mvp", reason: "already-migrated" }];
}

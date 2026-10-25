import type { ProductCourse } from "../../services/productStore";
import type { MigrationOrm } from "../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "./types";

export const id = "011_fix_modeling_life_media_urls";
export const description = "Replace environment-specific S3 staging URLs with course-media references.";
export const touches = ["courses"] as const;

const COURSE_ID = "modeling-life";
const MEDIA = {
  "lesson1.mp4": "/api/course-media/modeling-life/04f0039b-42c7-441b-85b7-fe6e21c6bbe6",
  "lesson2.mp4": "/api/course-media/modeling-life/613a07b1-24e8-4123-ab10-5bd36875293e"
} as const;

/** Only logical ids belong in course data; a bucket host must never leak in. */
function rewrite(value: string): string {
  const name = Object.keys(MEDIA).find((file) => value.endsWith(`/${file}`));
  return name ? MEDIA[name as keyof typeof MEDIA] : value;
}

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const courses = orm.table<ProductCourse>("courses");
  const course = courses.findById(COURSE_ID);
  if (!course) return [{ action: "skip", kind: "course", id: COURSE_ID, reason: "absent" }];
  let changed = false;
  const sections = course.sections.map((section) => ({
    ...section,
    lessons: section.lessons.map((lesson) => ({
      ...lesson,
      contents: lesson.contents?.map((content) => {
        const next = rewrite(content.url || "");
        if (next !== content.url) changed = true;
        return next === content.url ? content : { ...content, url: next };
      })
    }))
  }));
  if (!changed) return [{ action: "skip", kind: "course", id: COURSE_ID, reason: "already-logical" }];
  courses.update(COURSE_ID, { ...course, sections, updatedAt: ctx.now });
  return [{ action: "update", kind: "course", id: COURSE_ID }];
}

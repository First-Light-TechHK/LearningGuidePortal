import type { ProductCourse } from "../../services/productStore";
import type { MigrationOrm } from "../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "./types";

export const id = "017_fix_modeling_life_video_starts";
export const description = "Start each Modeling life Lesson's first video point at zero instead of the imported ten-second offset.";
export const touches = ["courses"] as const;

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const courses = orm.table<ProductCourse>("courses"), course = courses.findById("modeling-life");
  if (!course) return [{ action: "skip", kind: "course", id: "modeling-life", reason: "missing" }];
  if (course.slug !== "modeling-life") throw new Error(`${id}: course identity conflict.`);
  const sections = structuredClone(course.sections), changes: DataChange[] = [];
  for (const number of [1, 2]) {
    const lessonId = `modeling-life-lesson-${number}`, pointId = `modeling-life-l${number}-video-1`;
    const lessons = sections.flatMap(section => section.lessons).filter(lesson => lesson.id === lessonId);
    if (lessons.length > 1) throw new Error(`${id}: ambiguous Lesson identity.`);
    const lesson = lessons[0];
    if (!lesson) continue;
    const points = lesson.contents?.filter(content => content.id === pointId) || [];
    if (points.length > 1 || (points.length && (points[0].type !== "video" || (points[0].active !== false && lesson.contents?.find(content => content.type === "video" && content.active !== false)?.id !== pointId)))) throw new Error(`${id}: first video identity conflict.`);
    const point = points[0];
    // Only repair the shipped offset; preserve later author adjustments.
    if (!point || point.active === false || point.startSeconds !== 10) continue;
    point.startSeconds = 0;
    changes.push({ action: "update", kind: "lesson-content", id: pointId, reason: "video-start:10-to-0" });
  }
  if (!changes.length) return [{ action: "skip", kind: "course", id: course.id, reason: "no-imported-offsets" }];
  courses.update(course.id, { sections, updatedAt: new Date(Math.max(Date.parse(ctx.now), Date.parse(course.updatedAt) + 1)).toISOString() });
  return changes;
}

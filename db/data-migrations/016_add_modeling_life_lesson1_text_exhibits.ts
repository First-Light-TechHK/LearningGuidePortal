import type { LessonContent } from "../../contracts/lesson-content";
import type { ProductCourse } from "../../services/productStore";
import type { MigrationOrm } from "../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "./types";

export const id = "016_add_modeling_life_lesson1_text_exhibits";
export const description = "Place the two Lesson 01 video image exhibits before their authored text paragraphs.";
export const touches = ["courses"] as const;

const placements = [
  { source: "modeling-life-l1-exhibit-1", target: "modeling-life-l1-text-exhibit-1", anchor: "Our first example is going to be a single number." },
  { source: "modeling-life-l1-exhibit-2", target: "modeling-life-l1-text-exhibit-2", anchor: "T: Yes, that is the case. With electricity, the state variable might be voltage." },
];

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const courses = orm.table<ProductCourse>("courses"), course = courses.findById("modeling-life");
  if (!course) return [{ action: "skip", kind: "course", id: "modeling-life", reason: "missing" }];
  if (course.slug !== "modeling-life") throw new Error(`${id}: course identity conflict.`);
  const lessonId = "modeling-life-lesson-1";
  const lessons = course.sections.flatMap(section => section.lessons).filter(lesson => lesson.id === lessonId);
  if (!lessons.length) return [{ action: "skip", kind: "lesson", id: lessonId, reason: "missing" }];
  if (lessons.length !== 1) throw new Error(`${id}: ambiguous Lesson 01 identity.`);
  const contents = lessons[0].contents || [];
  const points = contents.filter(content => content.id === "modeling-life-l1-text-1" && content.type === "text");
  if (!points.length) return [{ action: "skip", kind: "lesson", id: lessonId, reason: "missing-text-point" }];
  if (points.length !== 1) throw new Error(`${id}: ambiguous text point.`);
  const point: LessonContent = structuredClone(points[0]);
  let changed = false;
  for (const placement of placements) {
    const marker = `<div data-exhibit-card="${placement.target}"></div>`;
    const markers = [...(point.html || "").matchAll(new RegExp(`<div\\b[^>]*data-exhibit-card=["']${placement.target}["'][^>]*>`, "g"))];
    const existing = contents.flatMap(content => content.nodes.map(node => ({ content, node }))).filter(item => item.node.id === placement.target);
    if (existing.length > 1 || existing.some(item => item.content.id !== point.id || item.node.type !== "image")) throw new Error(`${id}: exhibit identity conflict.`);
    if (markers.length > 1 || (markers.length && !existing.length)) throw new Error(`${id}: invalid existing exhibit marker.`);
    // Preserve later author edits on replay; never resynchronise an existing card.
    if (markers.length) continue;
    const sources = contents.filter(content => content.type === "video").flatMap(content => content.nodes).filter(node => node.id === placement.source);
    if (sources.length !== 1 || sources[0].type !== "image" || !sources[0].url || sources[0].active === false) throw new Error(`${id}: missing or ambiguous video exhibit.`);
    const escaped = placement.anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const anchor = new RegExp(`<p(?:\\s[^>]*)?>\\s*${escaped}`, "g");
    const matches = [...(point.html || "").matchAll(anchor)];
    if (matches.length !== 1) throw new Error(`${id}: missing or ambiguous paragraph: ${placement.anchor}`);
    const at = matches[0].index!;
    point.html = point.html!.slice(0, at) + marker + point.html!.slice(at);
    if (!existing.length) point.nodes.push({ ...structuredClone(sources[0]), id: placement.target, triggerTime: 0 });
    changed = true;
  }
  if (!changed) return [{ action: "skip", kind: "lesson", id: lessonId, reason: "text-exhibits-exist" }];
  point.exhibitMode = "authored";
  courses.update(course.id, {
    updatedAt: new Date(Math.max(Date.parse(ctx.now), Date.parse(course.updatedAt) + 1)).toISOString(),
    sections: course.sections.map(section => ({ ...section, lessons: section.lessons.map(lesson => lesson.id === lessonId ? { ...lesson, contents: contents.map(content => content.id === point.id ? point : content) } : lesson) })),
  });
  return [{ action: "update", kind: "lesson", id: lessonId, reason: "text-exhibits:2" }];
}

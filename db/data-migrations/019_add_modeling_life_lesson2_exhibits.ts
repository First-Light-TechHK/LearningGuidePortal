import type { LessonNode } from "../../contracts/lesson-content";
import type { ProductCourse } from "../../services/productStore";
import type { MigrationOrm } from "../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "./types";

export const id = "019_add_modeling_life_lesson2_exhibits";
export const description = "Reuse Lesson 1's two image exhibits in Lesson 2 text, timed video and Exploration.";
export const touches = ["courses"] as const;

const placements = [
  { number: 1, anchor: "T: Well let's work on that a little bit. 2m is of course, by definition, N plus P." },
  { number: 2, anchor: "S: So stability changes as A moves past K then." },
];

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const courses = orm.table<ProductCourse>("courses"), course = courses.findById("modeling-life");
  if (!course) return [{ action: "skip", kind: "course", id: "modeling-life", reason: "missing" }];
  if (course.slug !== "modeling-life") throw new Error(`${id}: course identity conflict.`);
  const sections = structuredClone(course.sections), lessons = sections.flatMap(section => section.lessons);
  const targets = lessons.filter(lesson => lesson.id === "modeling-life-lesson-2");
  if (!targets.length) return [{ action: "skip", kind: "lesson", id: "modeling-life-lesson-2", reason: "missing" }];
  if (targets.length !== 1) throw new Error(`${id}: ambiguous Lesson 02 identity.`);
  const sources = lessons.filter(lesson => lesson.id === "modeling-life-lesson-1");
  if (sources.length !== 1) throw new Error(`${id}: missing or ambiguous Lesson 01 identity.`);
  const target = targets[0], contents = target.contents || [];
  const videos = contents.filter(point => point.id === "modeling-life-l2-video-1");
  if (videos.length !== 1 || videos[0].type !== "video" || videos[0].active === false) throw new Error(`${id}: missing or ambiguous target video.`);
  const video = videos[0];
  let changed = false;
  const exhibits = target.exploration?.exhibits || [];
  for (const placement of placements) {
    const number = placement.number;
    const sourceNodes = sources[0].contents?.filter(point => point.type === "video").flatMap(point => point.nodes).filter(node => node.id === `modeling-life-l1-exhibit-${number}`) || [];
    if (sourceNodes.length !== 1 || sourceNodes[0].type !== "image" || sourceNodes[0].active === false || !sourceNodes[0].url) throw new Error(`${id}: missing or ambiguous source exhibit.`);
    const source = sourceNodes[0];
    const points = contents.filter(point => point.id === `modeling-life-l2-text-${number}`);
    if (points.length !== 1 || points[0].type !== "text" || points[0].active === false) throw new Error(`${id}: missing or ambiguous target text point.`);
    const point = points[0], textId = `modeling-life-l2-text-exhibit-${number}`, videoId = `modeling-life-l2-exhibit-${number}`;
    function addNode(contentId: string, node: LessonNode) {
      const existing = contents.flatMap(content => content.nodes.map(item => ({ content, node: item }))).filter(item => item.node.id === node.id);
      if (existing.length > 1 || existing.some(item => item.content.id !== contentId || item.node.type !== "image")) throw new Error(`${id}: exhibit identity conflict.`);
      if (!existing.length) { contents.find(content => content.id === contentId)!.nodes.push(node); changed = true; }
    }
    const markers = [...(point.html || "").matchAll(new RegExp(`<div\\b[^>]*data-exhibit-card=["']${textId}["'][^>]*>`, "g"))];
    if (markers.length > 1 || (markers.length && !point.nodes.some(node => node.id === textId))) throw new Error(`${id}: invalid existing exhibit marker.`);
    addNode(point.id, { ...structuredClone(source), id: textId, triggerTime: 0 });
    if (!markers.length) {
      const escaped = placement.anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matches = [...(point.html || "").matchAll(new RegExp(`<p(?:\\s[^>]*)?>\\s*${escaped}`, "g"))];
      if (matches.length !== 1) throw new Error(`${id}: missing or ambiguous midpoint paragraph.`);
      const at = matches[0].index!;
      point.html = point.html!.slice(0, at) + `<div data-exhibit-card="${textId}"></div>` + point.html!.slice(at);
      changed = true;
    }
    if (point.exhibitMode !== "authored") { point.exhibitMode = "authored"; changed = true; }
    addNode(video.id, { ...structuredClone(source), id: videoId });
    const explorationId = `modeling-life-exhibit-2-${number}`, existing = exhibits.filter(entry => entry.node.id === explorationId);
    if (existing.length > 1 || existing.some(entry => entry.node.type !== "image" || entry.lessonNumber !== "02")) throw new Error(`${id}: Exploration exhibit identity conflict.`);
    if (!existing.length) {
      exhibits.push({ node: { ...structuredClone(source), id: explorationId }, lessonNumber: "02", thumbnail: source.thumbnail || source.url! });
      changed = true;
    }
  }
  if (video.exhibitMode !== "authored") { video.exhibitMode = "authored"; changed = true; }
  if (!changed) return [{ action: "skip", kind: "lesson", id: target.id, reason: "exhibits-exist" }];
  target.exploration = { ...target.exploration, readings: target.exploration?.readings || [], exhibits };
  courses.update(course.id, { sections, updatedAt: new Date(Math.max(Date.parse(ctx.now), Date.parse(course.updatedAt) + 1)).toISOString() });
  return [{ action: "update", kind: "lesson", id: target.id, reason: "text-exhibits:2,video-exhibits:2,exploration-exhibits:2" }];
}

import { createHash } from "node:crypto";
import type { ProductCourse } from "./productStore";
import type { LessonBookmarkInput } from "@/contracts/lesson-bookmark";
import { LessonBookmarkError } from "@/contracts/lesson-bookmark";

export function lessonBookmarkContext(course: ProductCourse, lessonId: string, mode: "video" | "text") {
  const lessons = course.sections.flatMap(section => section.lessons);
  const lesson = lessons.find(item => item.id === lessonId);
  if (!lesson) throw new LessonBookmarkError("not_found", 404);
  const points = (lesson.contents || []).filter(point => point.active !== false && (mode === "video" ? point.type === "video" : point.type !== "video"));
  if (!points.length && (mode === "video" || !lesson.body?.trim())) throw new LessonBookmarkError("mode_unavailable", 400);
  const contentVersion = createHash("sha256").update(JSON.stringify({ mode, body: mode === "text" ? lesson.body : undefined,
    points: points.map(point => ({ id: point.id, type: point.type, html: point.html, url: point.url?.split("?")[0], startSeconds: point.startSeconds })) })).digest("hex");
  return { lesson, points, contentVersion, number: lessons.indexOf(lesson) + 1 };
}

export function resolveBookmarkLp(course: ProductCourse, input: LessonBookmarkInput) {
  const context = lessonBookmarkContext(course, input.lessonId, input.mode);
  if (context.contentVersion !== input.contentVersion) throw new LessonBookmarkError("content_changed", 409);
  const point = context.points.find(point => point.id === input.contentId);
  if (context.points.length ? !point : input.contentId !== null) throw new LessonBookmarkError("invalid_content", 400);
  if (input.mode === "text") {
    const count = point?.type === "pdf" ? 1 : Math.max(1, point ? point.html?.match(/<(?:p|h[1-6]|li|blockquote)\b/gi)?.length || 0 : context.lesson.body.split(/\n\s*\n/).filter(Boolean).length);
    const prefix = `${input.contentId || "body"}:paragraph:`;
    const suffix = input.paragraphId?.startsWith(prefix) ? input.paragraphId.slice(prefix.length) : "";
    const index = /^(0|[1-9][0-9]*)$/.test(suffix) ? Number(suffix) : NaN;
    if (!Number.isInteger(index) || index < 0 || index >= count) throw new LessonBookmarkError("invalid_paragraph", 400);
    return `${context.number}.${Math.max(0, context.points.findIndex(item => item.id === input.contentId)) + 1}`;
  }
  const source = point!.url?.split("?")[0];
  const timeline = context.points.map((item, index) => ({ item, index })).filter(({ item }) => item.url?.split("?")[0] === source)
    .sort((a, b) => (a.item.startSeconds || 0) - (b.item.startSeconds || 0) || a.index - b.index);
  const current = timeline.filter(({ item }) => (item.startSeconds || 0) * 1000 <= input.positionMs!).at(-1) || timeline[0];
  return `${context.number}.${current.index + 1}`;
}

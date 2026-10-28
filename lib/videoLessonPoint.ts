import type { LessonContent } from "@/contracts/lesson-content";

/** Resolve authored points within the currently loaded source; never cross videos. */
export function videoLessonPoint(contents: LessonContent[], selected: LessonContent, time: number): LessonContent {
  if (selected.type !== "video" || !selected.url || !Number.isFinite(time) || time < 0) return selected;
  const points = contents.filter(point => point.active !== false && point.type === "video" && point.url === selected.url
    && Number.isFinite(point.startSeconds ?? 0) && (point.startSeconds ?? 0) >= 0);
  let current = selected;
  let start = (selected.startSeconds ?? 0) <= time ? selected.startSeconds ?? 0 : -1;
  for (const point of points) {
    const position = point.startSeconds ?? 0;
    if (position <= time && position > start) { current = point; start = position; }
  }
  return current;
}

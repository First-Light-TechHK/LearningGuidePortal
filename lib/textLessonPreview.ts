import type { LessonContent } from "@/contracts/lesson-content";
import type { TextLessonPreview } from "@/contracts/text-lesson-preview";

export function textLessonPreviewPolicy(contents: LessonContent[]): TextLessonPreview {
  const points = contents.filter(point => point.active !== false && point.type !== "video");
  return {
    rule: points.length > 1 ? "third-point" : "half-text",
    points: Object.fromEntries(points.map((point, index) => [point.id, point.type === "pdf" ? "locked" : points.length === 1 ? "partial" : index < 2 ? "full" : "locked"])),
    legacy: points.length === 0,
  };
}

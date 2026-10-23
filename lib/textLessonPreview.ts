import type { LessonContent } from "@/contracts/lesson-content";
import type { TextLessonPreview } from "@/contracts/text-lesson-preview";
import type { LessonPreviewConfiguration } from "@/contracts/lesson-resources";

export function textLessonPreviewPolicy(contents: LessonContent[], preview?: LessonPreviewConfiguration): TextLessonPreview {
  const points = contents.filter(point => point.active !== false && point.type !== "video");
  if (preview && Number.isInteger(preview.textPointCount) && preview.textPointCount >= 0) return {
    rule: "configured-points", legacy: false,
    points: Object.fromEntries(points.map((point, index) => [point.id, point.type === "pdf" || index >= preview.textPointCount ? "locked" : "full"])),
  };
  return {
    rule: points.length > 1 ? "third-point" : "half-text",
    points: Object.fromEntries(points.map((point, index) => [point.id, point.type === "pdf" ? "locked" : points.length === 1 ? "partial" : index < 2 ? "full" : "locked"])),
    legacy: points.length === 0,
  };
}

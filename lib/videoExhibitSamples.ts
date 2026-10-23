import type { LessonContent, LessonNode } from "@/contracts/lesson-content";
import type { Locale } from "@/lib/i18n/config";
import { textExhibitSamples } from "./textExhibitSamples";

/** Display-only fallback for videos without configured exhibits. */
export function videoExhibitNodes(content: LessonContent, locale: Locale): LessonNode[] {
  const nodes = (content.nodes || []).filter(node => node.active !== false);
  if (content.type !== "video" || nodes.length || content.exhibitMode === "authored") return nodes;
  return textExhibitSamples(locale).map((node, index) => ({
    ...node, id: `${content.id}-${node.id}`, triggerTime: (index + 1) * 20,
  }));
}

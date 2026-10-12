import type { LessonNode } from "@/contracts/lesson-content";

/** Forward seeks skip past nodes; normal playback includes the configured boundary. */
export function dueVideoNodes(nodes: LessonNode[], previousTime: number, currentTime: number, seen: ReadonlySet<string>, interactive: boolean) {
  if (!Number.isFinite(currentTime) || currentTime < previousTime) return [];
  return nodes.filter(node => node.active !== false && (interactive || node.type !== "exercise") && Number.isFinite(node.triggerTime) && node.triggerTime >= 0 && node.triggerTime >= previousTime && node.triggerTime <= currentTime && !seen.has(node.id)).sort((a, b) => a.triggerTime - b.triggerTime);
}

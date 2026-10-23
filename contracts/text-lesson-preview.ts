/** Server-owned delivery policy; hidden bodies, exhibit payloads and URLs are omitted. */
export type TextLessonPreview = {
  rule: "third-point" | "half-text" | "configured-points";
  points: Record<string, "full" | "partial" | "locked">;
  legacy: boolean;
};

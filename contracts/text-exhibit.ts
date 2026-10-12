import type { LessonNode } from "./lesson-content";

export type TextExhibit = LessonNode & { type: "image" | "video" | "model3d" };

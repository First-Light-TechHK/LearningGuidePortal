import type { CourseLearningMode } from "./course-learning-mode";

export type KnowledgePosition = { lessonId: string; contentId: string | null };
export type KnowledgePositions = Partial<Record<CourseLearningMode, KnowledgePosition>>;
export type KnowledgeProgress = {
  mode: CourseLearningMode; current: number; total: number; progress: number;
  lessonId: string | null; contentId: string | null;
};

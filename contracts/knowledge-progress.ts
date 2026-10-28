import type { CourseLearningMode } from "./course-learning-mode";

export type KnowledgePosition = { lessonId: string; contentId: string | null };
export type KnowledgePositions = Partial<Record<CourseLearningMode, KnowledgePosition>>;
/** Server-owned location where the saved course maximum was reached. */
export type HighestCourseProgress = KnowledgePosition & { progress: number; mode: CourseLearningMode | null };
export type StudyEventKind = "open" | "video_progress" | "text_progress" | "complete";
export type StudyProgressInput = {
  courseId: string; lessonId: string; contentId?: string | null; learningMode?: CourseLearningMode;
  event: StudyEventKind; seconds: number; clientEventId: string; completeLesson?: boolean;
};
export type KnowledgeProgress = {
  mode: CourseLearningMode; current: number; total: number; progress: number;
  lessonId: string | null; contentId: string | null;
};

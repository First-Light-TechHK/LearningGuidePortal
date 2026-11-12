import type { CourseLearningMode, CourseModeSnapshot } from "./course-learning-mode";

/** Server-derived states and continuation; progress is retained for compatibility only. */
export type OverviewDisplayCourse = {
  learningState: "not_started" | "in_progress" | "completed";
  lessonTitle: string | null;
  bookmark: { mode: CourseLearningMode; lpNumber: string } | null;
  id: string; courseId: string; title: string; category: string; cover: string;
  lessonCount: number; currentLesson: number | null; lessonId: string | null; contentId: string | null;
  progress: number | null; mode: CourseLearningMode;
  action: "start" | "resume" | "review" | "plans" | "preview" | "detail";
  href: string;
};
export type OverviewDisplay = { name: string; courses: OverviewDisplayCourse[]; syncCourses?: CourseModeSnapshot[] };

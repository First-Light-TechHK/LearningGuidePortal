import type { CourseLearningMode } from "./course-learning-mode";

export type OverviewDesignCourse = {
  id: string; title: string; category: "chinese" | "science" | "european";
  cover: string; lessonCount: number; currentLesson: number | null;
  progress: number; mode: CourseLearningMode; action: "resume" | "review" | "plans";
  courseId: string | null; lessonId: string | null;
};
export type OverviewDesignSample = { name: string; courses: OverviewDesignCourse[] };

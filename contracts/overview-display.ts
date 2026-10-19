import type { CourseLearningMode } from "./course-learning-mode";

/** Server-derived cards. Progress is explicit completion, independent of the resume cursor. */
export type OverviewDisplayCourse = {
  id: string; courseId: string; title: string; category: string; cover: string;
  lessonCount: number; currentLesson: number | null; lessonId: string | null; contentId: string | null;
  progress: number | null; mode: CourseLearningMode;
  action: "resume" | "review" | "plans" | "preview" | "detail";
  href: string;
};
export type OverviewDisplay = { name: string; courses: OverviewDisplayCourse[] };

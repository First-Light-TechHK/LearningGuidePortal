import type { CourseLearningMode } from "./course-learning-mode";

export type OverviewCourseIdentity = {
  courseId: string;
  slug: string;
  title: string;
  category: string;
  cover: string | null;
};
export type LearningOverviewCourse = OverviewCourseIdentity & {
  kind: "learning";
  mode: CourseLearningMode;
  progress: number;
  currentLesson: number | null;
  currentLessonId: string | null;
  currentContentId?: string | null;
};
// Preview history has no course completion percentage.
export type PreviewOverviewCourse = OverviewCourseIdentity & { kind: "preview" };
export type LearningOverviewDisplay = {
  learning: LearningOverviewCourse[];
  previewed: PreviewOverviewCourse[];
};

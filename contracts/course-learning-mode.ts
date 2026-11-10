export type CourseLearningMode = "video" | "text";
export type CourseLearningModeContext = "preview" | "entitled";
export type CourseLearningModePreferences = Partial<Record<CourseLearningModeContext, CourseLearningMode>>;
export type CourseLearningModeInput = { mode: CourseLearningMode; lessonId?: string; accessContext?: CourseLearningModeContext };
export type CourseModePosition = { lessonId: string; contentId: string | null };
export type CourseLearningModeResult = { courseId: string; mode: CourseLearningMode; position?: CourseModePosition | null };
export type CourseModeSnapshot = {
  courseId: string; mode: CourseLearningMode;
  currentLessonId?: string | null; currentContentId?: string | null;
  progress?: number | null; updatedAt?: string | null;
};

export function isCourseLearningMode(value: unknown): value is CourseLearningMode {
  return value === "video" || value === "text";
}

export function isCourseLearningModeContext(value: unknown): value is CourseLearningModeContext {
  return value === "preview" || value === "entitled";
}

export class CourseLearningModeError extends Error {
  constructor(public code: "invalid" | "notFound" | "unauthorised" | "access_changed") { super(code); }
}

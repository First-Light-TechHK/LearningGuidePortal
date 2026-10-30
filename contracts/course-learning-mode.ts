export type CourseLearningMode = "video" | "text";
export type CourseLearningModeInput = { mode: CourseLearningMode; lessonId?: string };
export type CourseModePosition = { lessonId: string; contentId: string | null };
export type CourseLearningModeResult = { courseId: string; mode: CourseLearningMode; position?: CourseModePosition | null };
export type CourseModeSnapshot = { courseId: string; mode: CourseLearningMode };

export function isCourseLearningMode(value: unknown): value is CourseLearningMode {
  return value === "video" || value === "text";
}

export class CourseLearningModeError extends Error {
  constructor(public code: "invalid" | "notFound" | "unauthorised") { super(code); }
}

export type CourseLearningMode = "video" | "text";
export type CourseLearningModeInput = { mode: CourseLearningMode };
export type CourseLearningModeResult = { courseId: string; mode: CourseLearningMode };
export type CourseModeSnapshot = { courseId: string; mode: CourseLearningMode };

export function isCourseLearningMode(value: unknown): value is CourseLearningMode {
  return value === "video" || value === "text";
}

export class CourseLearningModeError extends Error {
  constructor(public code: "invalid" | "notFound" | "unauthorised") { super(code); }
}

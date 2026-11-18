type LessonDuration = { videoDurationSeconds?: number | null };

export function totalVideoMinutes(lessons: LessonDuration[]): number | null {
  if (!lessons.length || lessons.some(lesson => typeof lesson.videoDurationSeconds !== "number" || !Number.isFinite(lesson.videoDurationSeconds) || lesson.videoDurationSeconds < 0)) return null;
  return Math.ceil(lessons.reduce((total, lesson) => total + lesson.videoDurationSeconds!, 0) / 60);
}

/** Round once after summing video seconds; incomplete metadata uses configured minutes for the whole course. */
export function totalCourseMinutes(lessons: Array<LessonDuration & { durationMinutes?: number }>): number {
  return totalVideoMinutes(lessons) ?? lessons.reduce((total, lesson) => total + (lesson.durationMinutes || 0), 0);
}

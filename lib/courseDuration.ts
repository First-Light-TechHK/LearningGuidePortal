type LessonDuration = { videoDurationSeconds?: number | null };

export function totalVideoMinutes(lessons: LessonDuration[]): number | null {
  if (!lessons.length || lessons.some(lesson => typeof lesson.videoDurationSeconds !== "number" || !Number.isFinite(lesson.videoDurationSeconds) || lesson.videoDurationSeconds < 0)) return null;
  return Math.ceil(lessons.reduce((total, lesson) => total + lesson.videoDurationSeconds!, 0) / 60);
}

type LessonDuration = { videoDurationSeconds?: number | null };

/** Home-card duration label. Callers pass the locale's hour and minute suffixes. */
export function formatHomeCourseDuration(minutes: number, hourShort: string, minuteShort: string) {
  return `${Math.floor(minutes / 60)}${hourShort} ${minutes % 60}${minuteShort}`;
}

export function totalVideoMinutes(lessons: LessonDuration[]): number | null {
  if (!lessons.length || lessons.some(lesson => typeof lesson.videoDurationSeconds !== "number" || !Number.isFinite(lesson.videoDurationSeconds) || lesson.videoDurationSeconds < 0)) return null;
  return Math.ceil(lessons.reduce((total, lesson) => total + lesson.videoDurationSeconds!, 0) / 60);
}

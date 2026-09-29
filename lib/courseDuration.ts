type LessonDuration = { videoDurationSeconds?: number | null };

/** Home-card duration label. Callers pass the locale's hour and minute suffixes. */
export function formatHomeCourseDuration(minutes: number, hourShort: string, minuteShort: string) {
  const whole = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(whole / 60);
  const mins = whole % 60;
  if (hours === 0) return `${mins}${minuteShort}`;
  if (mins === 0) return `${hours}${hourShort}`;
  return `${hours}${hourShort} ${mins}${minuteShort}`;
}

export function totalVideoMinutes(lessons: LessonDuration[]): number | null {
  if (!lessons.length || lessons.some(lesson => typeof lesson.videoDurationSeconds !== "number" || !Number.isFinite(lesson.videoDurationSeconds) || lesson.videoDurationSeconds < 0)) return null;
  return Math.ceil(lessons.reduce((total, lesson) => total + lesson.videoDurationSeconds!, 0) / 60);
}

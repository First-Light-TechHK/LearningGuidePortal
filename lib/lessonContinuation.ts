import type { Locale } from "@/lib/i18n/config";

/** Called with the server-authorised course outline, in section/lesson order. */
export function nextLessonHref(locale: Locale, courseId: string, lessons: { id: string }[], currentLessonId: string): string | null {
  const index = lessons.findIndex(lesson => lesson.id === currentLessonId);
  const next = index >= 0 ? lessons[index + 1] : undefined;
  return next ? `/${locale}/account/learn/${encodeURIComponent(courseId)}?lessonId=${encodeURIComponent(next.id)}` : null;
}

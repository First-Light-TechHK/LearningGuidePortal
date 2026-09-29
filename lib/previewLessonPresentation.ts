import type { ProductCourse } from "@/services/productStore";

// Only public outline metadata crosses into the preview client component.
export function previewLessonOutline(course: ProductCourse, locale: string, entitled: boolean) {
  const previewLessonId = course.sections.flatMap(section => section.lessons)[0]?.isPublic
    ? course.sections.flatMap(section => section.lessons)[0]?.id : null;
  return course.sections.flatMap(section => section.lessons).map((lesson, index) => ({
    id: lesson.id,
    title: lesson.title,
    number: String(index + 1).padStart(2, "0"),
    href: lesson.id === previewLessonId
      ? `/${locale}/portal/courses/${course.id}/public-lesson?lessonId=${encodeURIComponent(lesson.id)}`
      : entitled ? `/${locale}/account/learn/${course.id}?lessonId=${encodeURIComponent(lesson.id)}` : null,
  }));
}

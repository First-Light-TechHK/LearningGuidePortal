import type { ProductCourse } from "@/services/productStore";
import type { CourseLearningMode } from "@/contracts/course-learning-mode";

export function lessonLearningModes(lesson: Pick<ProductCourse["sections"][number]["lessons"][number], "contents" | "body">): CourseLearningMode[] {
  const active = (lesson.contents || []).filter(content => content.active !== false);
  const modes: CourseLearningMode[] = [];
  if (active.some(content => content.type === "video")) modes.push("video");
  if (active.some(content => content.type === "text" || content.type === "pdf") || (!active.length && Boolean(lesson.body?.trim()))) modes.push("text");
  return modes;
}

// Only public outline metadata crosses into the preview client component.
export function previewLessonOutline(course: ProductCourse, locale: string, entitled: boolean) {
  const previewLessonId = course.sections.flatMap(section => section.lessons)[0]?.isPublic
    ? course.sections.flatMap(section => section.lessons)[0]?.id : null;
  return course.sections.flatMap(section => section.lessons).map((lesson, index) => ({
    id: lesson.id,
    title: lesson.title,
    number: String(index + 1).padStart(2, "0"),
    modes: lessonLearningModes(lesson),
    href: entitled ? `/${locale}/account/learn/${course.id}?lessonId=${encodeURIComponent(lesson.id)}` : lesson.id === previewLessonId
      ? `/${locale}/portal/courses/${course.id}/public-lesson?lessonId=${encodeURIComponent(lesson.id)}`
      : null,
  }));
}

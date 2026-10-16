import Link from "next/link";
import type { CourseSyllabusItem, CoursePageCta } from "@/lib/coursePage";

export function CourseCurriculumAction({ lesson, href, className, copy, cta, actionLessonId }: {
  lesson: CourseSyllabusItem;
  href: string | null;
  className: string;
  copy: { start: string; preview: string };
  cta: CoursePageCta;
  actionLessonId: string | null;
}) {
  if (lesson.lessonId !== actionLessonId) return null;
  const label = lesson.access === "entitled" ? copy.start : copy.preview;
  if (!lesson.openable || !href) return <button type="button" className={className} disabled>{label}</button>;
  return <Link prefetch={false} className={className} href={href} data-course-cta-link={lesson.access === "entitled" ? "continue_learning" : cta === "continue_preview" ? "continue_preview" : "start_preview"}>{label}</Link>;
}

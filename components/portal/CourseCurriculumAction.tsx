import Link from "next/link";
import type { CourseSyllabusItem, CoursePageCta } from "@/lib/coursePage";

export function CourseCurriculumAction({ lesson, href, className, copy, cta, actionLessonId }: {
  lesson: CourseSyllabusItem;
  href: string | null;
  className: string;
  copy: { start: string; preview: string; continue: string; review: string };
  cta: CoursePageCta;
  actionLessonId: string | null;
}) {
  if (lesson.access !== "entitled" && lesson.lessonId !== actionLessonId) return null;
  const entitled = lesson.access === "entitled";
  const label = entitled ? lesson.completed ? copy.review : lesson.continuable ? copy.continue : copy.start : copy.preview;
  const primary = entitled && !lesson.completed && lesson.lessonId === actionLessonId;
  if (!lesson.openable || !href) return <button type="button" className={className} disabled>{label}</button>;
  return <Link prefetch={false} className={className} href={href} data-course-primary={primary ? "true" : "false"} data-course-cta-link={entitled ? "continue_learning" : cta === "continue_preview" ? "continue_preview" : "start_preview"}><span>{label}</span>{entitled && !primary && <span aria-hidden="true"> ›</span>}</Link>;
}

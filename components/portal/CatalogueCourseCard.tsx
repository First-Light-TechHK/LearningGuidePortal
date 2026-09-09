import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CourseThumbnail } from "@/components/portal/CourseThumbnail";
import { totalVideoMinutes } from "@/lib/courseDuration";
import { getMessages } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/config";
import type { ProductCourse } from "@/services/productStore";

export function CatalogueCourseCard({ course, category, locale }: { course: ProductCourse; category: string; locale: Locale }) {
  const copy = getMessages(locale).portal;
  const lessons = course.sections.flatMap(section => section.lessons);
  const videoMinutes = totalVideoMinutes(lessons);
  return <article className="portal-course-card">
    <div className="portal-course-image-wrap"><CourseThumbnail slug={course.slug} title={course.title} /></div>
    <div className="portal-course-card-body">
      <h3>{course.title}</h3><div className="portal-course-category">{category}</div><p>{course.description}</p>
      <div className="portal-course-card-bottom"><div className="portal-course-meta"><span>{lessons.length} {copy.lessonCount}</span>{videoMinutes === null ? null : <span>{videoMinutes} {copy.minutesShort} {copy.videoDuration}</span>}</div>
        <Link prefetch={false} className="portal-course-link" href={`/${locale}/portal/courses/${course.id}`}>{copy.viewCourse}<ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
    </div>
  </article>;
}

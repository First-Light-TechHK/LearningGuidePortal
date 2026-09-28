import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CourseThumbnail } from "@/components/portal/CourseThumbnail";
import { totalVideoMinutes } from "@/lib/courseDuration";
import { getMessages } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/config";
import type { ProductCourse } from "@/services/productStore";

export function CatalogueCourseCard({ course, category, locale, variant = "catalogue" }: { course: ProductCourse; category: string; locale: Locale; variant?: "catalogue" | "home" }) {
  const copy = getMessages(locale).portal;
  const lessons = course.sections.flatMap(section => section.lessons);
  const videoMinutes = totalVideoMinutes(lessons);
  if (variant === "home") {
    const minutes = videoMinutes ?? lessons.reduce((total, lesson) => total + lesson.durationMinutes, 0);
    const homeCopy = getMessages(locale).homeDesign;
    return <article className="home-course-card" data-course-id={course.id}>
      <div className="home-course-cover"><CourseThumbnail slug={course.slug} title={course.title} src={course.cover || course.thumbnailPath} /><span className="home-course-category">{category}</span></div>
      <div className="home-course-body"><div className="home-course-heading"><h3>{course.title}</h3><p className="home-course-meta">{lessons.length} {copy.lessonCount} · {Math.floor(minutes / 60)}{homeCopy.hourShort} {minutes % 60}{homeCopy.minuteShort}</p></div>
        <div className="home-course-description"><p>{course.description}</p><Link prefetch={false} href={`/${locale}/portal/courses/${course.id}`} aria-label={`${copy.viewCourse}: ${course.title}`}><span aria-hidden="true">→</span></Link></div>
      </div>
    </article>;
  }
  return <article className="portal-course-card">
    <div className="portal-course-image-wrap"><CourseThumbnail slug={course.slug} title={course.title} src={course.cover || course.thumbnailPath} /></div>
    <div className="portal-course-card-body">
      <h3>{course.title}</h3><div className="portal-course-category">{category}</div><p>{course.description}</p>
      <div className="portal-course-card-bottom"><div className="portal-course-meta"><span>{lessons.length} {copy.lessonCount}</span>{videoMinutes === null ? null : <span>{videoMinutes} {copy.minutesShort} {copy.videoDuration}</span>}</div>
        <Link prefetch={false} className="portal-course-link" href={`/${locale}/portal/courses/${course.id}`}>{copy.viewCourse}<ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
    </div>
  </article>;
}

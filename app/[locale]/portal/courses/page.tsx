import Link from "next/link";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { listPublishedCourses } from "@/services/productStore";
import { CourseThumbnail } from "@/components/portal/CourseThumbnail";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { BannerCarousel } from "@/components/portal/BannerCarousel";

export default async function CoursesPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ category?: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = localeFrom(rawLocale);
  const copy = getMessages(locale).portal;
  const courses = await listPublishedCourses();
  const category = ((await searchParams).category || "All").trim();
  const visibleCourses = category === "All" ? courses : courses.filter((course) => (course.category || "European Humanities") === category);
  const categoryValues = ["All", "Chinese Humanities", "European Humanities", "Science"];

  return (
    <main className="portal-page portal-catalog-page">
      <PortalHeader locale={locale} active="courses" />
      <BannerCarousel locale={locale} />
      <section className="portal-section portal-section-first portal-catalog-courses"><div className="portal-section-heading"><div><p className="portal-eyebrow">{copy.featuredCourses}</p><h2>{copy.popularCourses}</h2><p className="portal-section-description">{copy.popularCoursesDescription}</p></div></div><nav className="portal-category-filter" aria-label={copy.category}>{categoryValues.map((value, index) => <Link key={value} className={category === value ? "active" : ""} href={`/${locale}/portal/courses?category=${encodeURIComponent(value)}`}>{copy.courseCategories[index]}</Link>)}</nav>{visibleCourses.length ? <div className="portal-course-grid">{visibleCourses.map((course) => { const lessonCount = course.sections.reduce((total, section) => total + section.lessons.length, 0); const duration = course.sections.flatMap((section) => section.lessons).reduce((total, lesson) => total + lesson.durationMinutes, 0); return <article className="portal-course-card" key={course.id}><div className="portal-course-image-wrap"><CourseThumbnail slug={course.slug} title={course.title} /></div><div className="portal-course-card-body"><h3>{course.title}</h3><div className="portal-course-category">{course.category || "European Humanities"}</div><p>{course.description}</p><div className="portal-course-meta"><span>{lessonCount} {copy.lessonCount}</span><span>{duration} {copy.minutesShort} {copy.videoDuration}</span></div><Link className="portal-button portal-button-primary" href={`/${locale}/portal/courses/${course.id}`}>{copy.openCourse}</Link></div></article>; })}</div> : <p className="portal-empty">{copy.noCourses}</p>}</section>
      <section className="portal-why-band"><div><p className="portal-eyebrow">{copy.whyUs}</p><h2>{copy.whyUsTitle}</h2></div></section>
      <PortalFooter locale={locale} />
    </main>
  );
}

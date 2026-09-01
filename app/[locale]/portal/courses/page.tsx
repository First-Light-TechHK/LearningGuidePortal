import Link from "next/link";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { listPublishedCourses } from "@/services/productStore";
import { CourseThumbnail } from "@/components/portal/CourseThumbnail";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";

export default async function CoursesPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = localeFrom(rawLocale);
  const copy = getMessages(locale).portal;
  const courses = await listPublishedCourses();
  const query = ((await searchParams).q || "").trim().toLowerCase();
  const visibleCourses = query ? courses.filter((course) => `${course.title} ${course.description}`.toLowerCase().includes(query)) : courses;

  return (
    <main className="portal-page portal-catalog-page">
      <PortalHeader locale={locale} active="courses" />
      <section className="portal-catalog-hero"><div className="portal-catalog-hero-inner"><h1>{copy.catalogTitle}</h1><p>{copy.catalogDescription}</p><form className="portal-course-search" action={`/${locale}/portal/courses`}><input name="q" placeholder={copy.searchCourses} aria-label={copy.searchCourses} /><button className="portal-button portal-button-primary" type="submit">{copy.search}</button></form></div></section>
      <section className="portal-benefits portal-benefits-catalog" aria-labelledby="catalog-benefits-heading"><div className="portal-section-heading"><h2 id="catalog-benefits-heading">{copy.whatYouWillLearn}</h2></div><div className="portal-benefits-grid">{copy.benefits.map((benefit) => <div className="portal-benefit" key={benefit}><span className="portal-benefit-icon" aria-hidden="true">✓</span><strong>{benefit}</strong><p>{copy.catalogDescription}</p></div>)}</div></section>
      <section className="portal-section portal-section-first portal-catalog-courses"><div className="portal-section-heading"><div><p className="portal-eyebrow">{copy.featuredCourses}</p><h2>{copy.popularCourses}</h2><p className="portal-section-description">{copy.popularCoursesDescription}</p></div></div>{visibleCourses.length ? <div className="portal-course-grid">{visibleCourses.map((course) => { const lessonCount = course.sections.reduce((total, section) => total + section.lessons.length, 0); return <article className="portal-course-card" key={course.id}><div className="portal-course-image-wrap"><CourseThumbnail slug={course.slug} title={course.title} /><span className="portal-course-tag">Course</span></div><div className="portal-course-card-body"><h3>{course.title}</h3><div className="portal-course-meta"><span>{copy.publicFirstLesson}</span><span>{lessonCount} {copy.lessons.toLowerCase()}</span></div><p>{course.description}</p><Link className="portal-button portal-button-primary" href={`/${locale}/portal/courses/${course.id}`}>{copy.openCourse}</Link></div></article>; })}</div> : <p className="portal-empty">{query ? `${copy.noCourses} (${query})` : copy.noCourses}</p>}</section>
      <section className="portal-why-band"><div><p className="portal-eyebrow">{copy.whyUs}</p><h2>{copy.whyUsTitle}</h2></div></section>
      <PortalFooter locale={locale} />
    </main>
  );
}

import Link from "next/link";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { getPortalContent, listPublishedCourses } from "@/services/productStore";
import { currentProductUser } from "@/services/productAuth";
import { CatalogueCourseCard } from "@/components/portal/CatalogueCourseCard";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { BannerCarousel } from "@/components/portal/BannerCarousel";

export default async function PortalHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = localeFrom(rawLocale);
  const copy = getMessages(locale).portal;
  const courses = await listPublishedCourses();
  const content = await getPortalContent();
  const user = await currentProductUser();

  return (
    <main className="portal-page portal-home-page">
      <PortalHeader locale={locale} signedIn={Boolean(user)} displayName={user?.nickname} avatarUrl={user?.avatarPath ? "/api/my-learning/avatar" : undefined} />
      <BannerCarousel locale={locale} />

      <section className="portal-section portal-section-courses" aria-labelledby="course-heading">
        <div className="portal-section-heading"><div><p className="portal-eyebrow">{copy.featuredCourses}</p><h2 id="course-heading">{copy.popularCourses}</h2><p className="portal-section-description">{copy.popularCoursesDescription}</p></div></div>
        {courses.length ? <div className="portal-course-grid">{courses.map(course => <CatalogueCourseCard key={course.id} course={course} locale={locale} category={content.categories.find(item => item.id === (course.category || "European Humanities"))?.labels[locale] || course.category || ""} />)}</div> : <p className="portal-empty">{copy.noCourses}</p>}
        <div className="portal-explore-more"><Link prefetch={false} className="portal-button portal-button-primary" href={`/${locale}/portal/courses`}>{copy.viewCourses}</Link></div>
      </section>

      <section className="portal-quick-guide"><div><p className="portal-eyebrow">{copy.whyUs}</p><h2>{copy.whyUsTitle}</h2><div className="portal-guide-list">{copy.quicklyGuideSteps.map((step, index) => <div key={step}><span>0{index + 1}</span><strong>{step}</strong></div>)}</div></div><div className="portal-quick-guide-image" role="img" aria-label="A learner studying in a library" /></section>
      <PortalFooter locale={locale} />
    </main>
  );
}

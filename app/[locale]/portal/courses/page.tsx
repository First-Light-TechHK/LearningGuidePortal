import Link from "next/link";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { getPortalContent, listPublishedCourses } from "@/services/productStore";
import { CatalogueCourseCard } from "@/components/portal/CatalogueCourseCard";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { BannerCarousel } from "@/components/portal/BannerCarousel";
import { currentProductUser } from "@/services/productAuth";

export default async function CoursesPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ category?: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = localeFrom(rawLocale);
  const copy = getMessages(locale).portal;
  const courses = await listPublishedCourses();
  const user = await currentProductUser();
  const category = ((await searchParams).category || "All").trim();
  const visibleCourses = category === "All" ? courses : courses.filter((course) => (course.category || "European Humanities") === category);
  const content = await getPortalContent();
  const categories = [{ id: "All", labels: { "en-GB": "All", "zh-CN": "全部" } }, ...content.categories];

  return (
    <main className="portal-page portal-catalog-page">
      <PortalHeader locale={locale} active="courses" signedIn={Boolean(user)} displayName={user?.nickname} avatarUrl={user?.avatarPath ? "/api/my-learning/avatar" : undefined} />
      <BannerCarousel locale={locale} />
      <section className="portal-section portal-section-first portal-catalog-courses">
        <div className="portal-section-heading"><div><h2>{copy.exploreAllCourses}</h2><p className="portal-section-description">{copy.exploreDescription}</p></div></div>
        <nav className="portal-category-filter" aria-label={copy.category}>{categories.map(item => <Link key={item.id} prefetch={false} className={category === item.id ? "active" : ""} aria-current={category === item.id ? "page" : undefined} href={`/${locale}/portal/courses?category=${encodeURIComponent(item.id)}`}>{item.labels[locale]}</Link>)}</nav>
        {visibleCourses.length ? <div className="portal-course-grid">{visibleCourses.map(course => <CatalogueCourseCard key={course.id} course={course} locale={locale} category={content.categories.find(item => item.id === (course.category || "European Humanities"))?.labels[locale] || course.category || ""} />)}</div> : <p className="portal-empty">{copy.noCourses}</p>}
      </section>
      <section className="portal-why-band"><div><p className="portal-eyebrow">{copy.whyUs}</p><h2>{copy.whyUsTitle}</h2></div></section>
      <PortalFooter locale={locale} />
    </main>
  );
}

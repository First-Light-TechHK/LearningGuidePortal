import Link from "next/link";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { catalogueFilterState, courseCardCategoryLine } from "@/lib/courseDetailPresentation";
import { getPortalContent, listCatalogueEntries, listPublishedCourses } from "@/services/productStore";
import { CatalogueCourseCard } from "@/components/portal/CatalogueCourseCard";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { currentProductUser } from "@/services/productAuth";
import { signCourseMediaUrl } from "@/services/persistence/s3";

export default async function CoursesPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ category?: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = localeFrom(rawLocale);
  const copy = getMessages(locale).portal;
  const courses = await listPublishedCourses();
  const user = await currentProductUser();
  const category = ((await searchParams).category || "All").trim();
  const content = await getPortalContent();
  const catalogue = await listCatalogueEntries();
  const filter = catalogueFilterState({
    requestedCategory: category,
    courses,
    categories: content.categories,
    catalogue,
    locale,
    allLabel: copy.allCategories,
  });

  return (
    <main className="portal-page portal-catalog-page">
      <PortalHeader locale={locale} active="courses" signedIn={Boolean(user)} displayName={user?.nickname} avatarUrl={user?.avatarPath ? "/api/my-learning/avatar" : undefined} />
      <section className="courses-design-hero"><div><h1>{copy.exploreAllCourses}</h1><p>{copy.exploreDescription}</p>{courses[0] ? <Link className="portal-button" href={`/${locale}/portal/courses/${courses[0].slug}/public-lesson`}>{copy.startPreview}</Link> : null}</div></section>
      <section className="portal-section portal-section-first portal-catalog-courses">
        <div className="portal-section-heading"><div><h2>{copy.exploreAllCourses}</h2><p className="portal-section-description">{copy.exploreDescription}</p></div></div>
        <nav className="portal-category-filter" aria-label={copy.category}>{filter.chips.map(item => <Link key={item.id} prefetch={false} className={item.active ? "active" : ""} aria-current={item.active ? "page" : undefined} href={`/${locale}/portal/courses?category=${encodeURIComponent(item.id)}`}>{item.label}</Link>)}</nav>
        {filter.visible.length ? <div className="portal-course-grid">{await Promise.all(filter.visible.map(async course => <CatalogueCourseCard key={course.id} course={{ ...course, cover: await signCourseMediaUrl(course.cover || course.thumbnailPath || "") }} locale={locale} category={courseCardCategoryLine(course, content.categories, locale, catalogue)} />))}</div> : <p className="portal-empty">{copy.noCourses}</p>}
      </section>
      <section className="courses-design-method"><div><p className="portal-eyebrow">{copy.whyUs}</p><h2>{copy.whyUsTitle}</h2><p>{copy.exploreDescription}</p></div><ol>{copy.methodSteps.map((step) => <li key={step}>{step}</li>)}</ol></section>
      <PortalFooter locale={locale} />
    </main>
  );
}

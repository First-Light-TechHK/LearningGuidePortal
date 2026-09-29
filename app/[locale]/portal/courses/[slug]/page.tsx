import { Fragment } from "react";
import Image from "next/image";
import Link from "next/link";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { courseBreadcrumb, courseLearningOutcomes, courseLessonCardDescription, courseLessonDuration, courseTrackChip } from "@/lib/courseDetailPresentation";
import { courseSidebarHref, courseSidebarOffer } from "@/lib/offer";
import { CourseLearningOutcomes } from "@/components/portal/CourseLearningOutcomes";
import { getCoursePage, getPortalContent, getProductCourse, listCatalogueEntries, listPlans, listPublishedCourses } from "@/services/productStore";
import { CourseThumbnail } from "@/components/portal/CourseThumbnail";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { currentProductUser } from "@/services/productAuth";
import { signCourseMediaUrl } from "@/services/persistence/s3";
import styles from "@/components/portal/course-detail.module.css";

const asset = (name: string) => `/portal/course-detail/${name}.svg`;

export default async function CourseDetailPage({ params }: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: rawLocale, slug } = await params;
  const locale = localeFrom(rawLocale);
  const user = await currentProductUser();
  const [page, course] = await Promise.all([getCoursePage(slug, user?.id), getProductCourse(slug)]);
  const messages = getMessages(locale);
  const copy = messages.portal;
  const detail = messages.courseDetailDesign;
  const identity = page.identity;
  const content = await getPortalContent();
  const catalogue = await listCatalogueEntries();
  const crumbs = courseBreadcrumb({
    locale,
    homeLabel: detail.home,
    coursesLabel: copy.navigation.courses,
    courseInfoLabel: detail.courseInfo,
    course,
    categories: content.categories,
    catalogue,
  });
  const track = courseTrackChip(course, content.categories, locale, catalogue);
  const catalogHref = `/${locale}/portal/courses`;
  const plans = page.pageState === "available" ? await listPlans() : [];
  const publishedCourses = page.pageState === "available" ? await listPublishedCourses() : [];
  const offer = courseSidebarOffer(plans, publishedCourses, identity?.track || "", catalogue);
  const pricingHref = offer ? courseSidebarHref(locale, offer) : `/${locale}/pricing`;
  const price = offer ? new Intl.NumberFormat(locale, {
    style: "currency", currency: offer.currency, currencyDisplay: "narrowSymbol",
    maximumFractionDigits: offer.amountMinor % 100 ? 2 : 0,
  }).format(offer.amountMinor / 100) : null;
  const signedCover = await signCourseMediaUrl(course?.cover || course?.thumbnailPath || "");
  const hours = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format((identity?.totalMinutes || 0) / 60);
  const lessonMetadata = new Map(course?.sections.flatMap(section => section.lessons.map(lesson => [lesson.id, {
    duration: courseLessonDuration(lesson),
    // Only public syllabus metadata, never protected lesson body/content.
    description: courseLessonCardDescription(section, lesson),
  }] as const)) || []);
  const outcomes = courseLearningOutcomes(course);

  return (
    <main className={`portal-page ${styles.page}`} data-page-state={page.pageState} data-course-cta={page.cta || "none"} data-access-state={page.accessState}>
      <PortalHeader locale={locale} active="courses" signedIn={Boolean(user)} displayName={user?.nickname} avatarUrl={user?.avatarPath ? "/api/my-learning/avatar" : undefined} />
      {page.pageState === "failed" || !identity ? (
        <section className="portal-section portal-section-first" data-course-failed="true">
          <h1>{copy.courseUnavailable}</h1>
          <p>{copy.courseUnavailableDescription}</p>
          <Link className="portal-text-link" href={catalogHref}>{copy.viewCourses}</Link>
        </section>
      ) : <>
        <nav className={styles.breadcrumb} aria-label={detail.breadcrumb}>
          {crumbs.map((crumb, index) => <Fragment key={`${crumb.label}-${index}`}>
            {index > 0 ? <Image src={asset("chevron-right")} alt="" width={12} height={12} /> : null}
            {crumb.href ? <Link href={crumb.href}>{crumb.label}</Link> : <span aria-current="page">{crumb.label}</span>}
          </Fragment>)}
        </nav>
        <section className={styles.hero}>
          <div className={styles.cover}><CourseThumbnail slug={course?.slug || slug} title={identity.title} src={signedCover} /></div>
          <div className={styles.heroCopy}>
            <p className={styles.tag} data-course-track={track?.categoryId || ""}>{track?.label || ""}</p>
            <h1 data-course-title={identity.title}>{identity.title}</h1>
            <p className={styles.summary}>{course?.subtitle || course?.description || ""}</p>
            <div className={styles.stats} data-preview-available={identity.previewAvailable ? "true" : "false"}>
              <span data-lesson-count={identity.lessonCount}>{identity.lessonCount} {detail.lessons}</span>
              <span data-total-minutes={identity.totalMinutes}>{hours} {detail.hours}</span>
            </div>
          </div>
        </section>
        {page.pageState === "withdrawn" ? (
          <section className={styles.body}><p data-course-withdrawn="true">{messages.learning.courseWithdrawn}</p></section>
        ) : (
          <section className={styles.body}>
            <div className={styles.mainColumn}>
              <section className={`${styles.card} ${styles.overview}`}>
                <h2>{detail.overview}</h2>
                <p className={styles.description}>{course?.description || ""}</p>
                <CourseLearningOutcomes className={styles.outcomes} title={detail.outcomesTitle} outcomes={outcomes} />
              </section>
              <section className={`${styles.card} ${styles.curriculum}`} data-syllabus="true">
                <h2>{detail.curriculum}</h2>
                <details open>
                  <summary>
                    <span className={styles.meta}>
                      <span><Image src={asset("lessons")} alt="" width={20} height={20} />{identity.lessonCount} {detail.lessons}</span>
                      <span><Image src={asset("clock")} alt="" width={20} height={20} />{hours} {detail.hours}</span>
                    </span>
                    <span className={styles.toggle}><span className={styles.less}>{detail.less}</span><span className={styles.more}>{detail.more}</span><Image src={asset("chevron-up")} alt="" width={16} height={16} /></span>
                  </summary>
                  <div className={styles.lessonList}>
                    {page.syllabus.map((lesson, index) => {
                      const lessonHref = !course || !lesson.openable ? null : lesson.access === "entitled"
                        ? `/${locale}/account/learn/${course.id}`
                        : `/${locale}/portal/courses/${course.id}/public-lesson?lessonId=${encodeURIComponent(lesson.lessonId)}`;
                      const metadata = lessonMetadata.get(lesson.lessonId);
                      return <article className={styles.lesson} key={lesson.lessonId} data-lesson-id={lesson.lessonId} data-lesson-access={lesson.access} data-lesson-openable={lesson.openable ? "true" : "false"}>
                        <div className={styles.lessonMain}>
                          <h3><span>{detail.lesson} {index + 1}</span>{lessonHref ? <Link href={lessonHref}>{lesson.title}</Link> : lesson.title}</h3>
                          <div className={styles.lessonDescription}><time>{metadata?.duration || "—"}</time><p>{metadata?.description}</p></div>
                        </div>
                        {lessonHref ? <Link className={styles.preview} href={lessonHref} data-course-cta-link={lesson.access === "entitled" ? "continue_learning" : page.cta === "continue_preview" ? "continue_preview" : "start_preview"}>{lesson.access === "entitled" ? messages.learning.continue : detail.preview}</Link> : null}
                      </article>;
                    })}
                  </div>
                </details>
              </section>
            </div>
            <aside className={styles.aside}>
              <section className={`${styles.card} ${styles.provides}`}>
                <h2>{detail.provides}</h2>
                <ul>{detail.features.map((feature, index) => <li key={feature}><Image src={asset(["video", "exhibits", "assistant", "comprehension", "readings", "bilingual"][index])} alt="" width={20} height={20} />{feature}</li>)}</ul>
              </section>
              <section className={styles.subscription} data-offer-scope={offer?.scope} data-offer-plan-id={offer?.planId} data-offer-amount={offer?.amountMinor}>
                <h2>{detail.included}</h2>
                <p className={styles.price}>{price && offer ? <><strong>{price} /</strong><span>{offer.termMonths} {detail.months}</span></> : <span>{messages.pricingDesign.unavailable}</span>}</p>
                <Link className={styles.benefits} href={pricingHref} data-course-cta-link={page.cta === "view_plans" ? "view_plans" : undefined} data-course-secondary-cta={page.secondaryCta || undefined}>{detail.benefits}</Link>
              </section>
            </aside>
          </section>
        )}
      </>}
      <PortalFooter locale={locale} />
    </main>
  );
}

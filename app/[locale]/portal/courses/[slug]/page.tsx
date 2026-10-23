import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { courseCategoryPlan, courseDurationParts, courseLessonDuration } from "@/lib/courseDetailPresentation";
import { formatPlanPrice } from "@/lib/planPricing";
import { getCoursePage, getProductCourse, getCourseLearningMode, listPlans } from "@/services/productStore";
import { CourseLearningModeDialog } from "@/components/portal/CourseLearningModeDialog";
import { availableCourseLearningModes } from "@/lib/courseLearningMode";
import { CourseThumbnail } from "@/components/portal/CourseThumbnail";
import { CourseCurriculumAction } from "@/components/portal/CourseCurriculumAction";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { StreamedContent } from "@/components/portal/StreamedContent";
import { currentProductUser } from "@/services/productAuth";
import { signCourseMediaUrl } from "@/services/persistence/s3";
import styles from "@/components/portal/course-detail.module.css";

const asset = (name: string) => `/portal/course-detail/${name}.svg`;

export default async function CourseDetailPage({ params, searchParams }: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams?: Promise<{ lessonEntry?: string }>;
}) {
  const { locale: rawLocale, slug } = await params;
  const locale = localeFrom(rawLocale);
  const user = await currentProductUser();
  const [page, course] = await Promise.all([getCoursePage(slug, user?.id), getProductCourse(slug)]);
  const savedMode = user && course ? await getCourseLearningMode(user.id, course.id) : null;
  // A visitor signs in to return to the course detail, not to replay the
  // unauthenticated lesson-entry redirect. Preview remains an explicit action.
  const courseDetailHref = `/${locale}/portal/courses/${encodeURIComponent(slug)}`;
  const signInHref = `/${locale}/portal/sign-in?returnTo=${encodeURIComponent(courseDetailHref)}`;
  const entryLessonId = (await searchParams)?.lessonEntry;
  const entryLesson = page.pageState === "available" ? page.syllabus.find(lesson => lesson.lessonId === entryLessonId && lesson.openable) : null;
  const needsMode = !savedMode && Boolean(course && availableCourseLearningModes(course).length > 1);
  const entryDestination = course && entryLesson ? entryLesson.access === "entitled"
    ? `/${locale}/account/learn/${course.id}?lessonId=${encodeURIComponent(entryLesson.lessonId)}`
    : `/${locale}/portal/courses/${course.id}/public-lesson?lessonId=${encodeURIComponent(entryLesson.lessonId)}` : null;
  if (entryDestination && !user) redirect(signInHref);
  if (entryDestination && user && !needsMode) redirect(entryDestination);
  const messages = getMessages(locale);
  const copy = messages.portal;
  const detail = messages.courseDetailDesign;
  const identity = page.identity;
  const catalogHref = `/${locale}/portal/courses`;
  const hasCourseAccess = page.cta === "continue_learning";
  const actionLesson = page.syllabus.find(lesson => lesson.lessonId === page.actionLessonId && lesson.openable && lesson.access === "entitled");
  const learningHref = course && actionLesson ? needsMode
    ? `${courseDetailHref}?lessonEntry=${encodeURIComponent(actionLesson.lessonId)}`
    : `/${locale}/account/learn/${encodeURIComponent(course.id)}?lessonId=${encodeURIComponent(actionLesson.lessonId)}` : null;
  const plans = page.pageState === "available" && !hasCourseAccess ? await listPlans() : [];
  const plan = courseCategoryPlan(plans, identity?.track || "");
  const pricingHref = `/${locale}/subscription?courseId=${encodeURIComponent(course?.id || slug)}${plan ? `&planId=${encodeURIComponent(plan.id)}` : ""}`;
  const price = plan ? formatPlanPrice(locale, plan) : null;
  const signedCover = await signCourseMediaUrl(course?.cover || course?.thumbnailPath || "");
  const durationParts = courseDurationParts(identity?.totalMinutes || 0);
  const durationNumber = new Intl.NumberFormat(locale);
  const durationLabel = `${durationNumber.format(durationParts.hours)}${messages.homeDesign.hourShort}${durationNumber.format(durationParts.minutes)}${messages.homeDesign.minuteShort}`;
  const lessonMetadata = new Map(course?.sections.flatMap(section => section.lessons.map(lesson => [lesson.id, {
    duration: courseLessonDuration(lesson),
    // Only public syllabus metadata, never protected lesson body/content.
    description: lesson.summary?.trim() || "",
  }] as const)) || []);

  return (
    <main className={`portal-page ${styles.page}`} data-page-state={page.pageState} data-course-cta={page.cta || "none"} data-access-state={page.accessState}>
      <StreamedContent>
      <PortalHeader locale={locale} active="courses" signedIn={Boolean(user)} displayName={user?.nickname} avatarUrl={user?.avatarPath ? "/api/my-learning/avatar" : undefined} />
      {page.pageState === "failed" || !identity ? (
        <section className="portal-section portal-section-first" data-course-failed="true">
          <h1>{copy.courseUnavailable}</h1>
          <p>{copy.courseUnavailableDescription}</p>
          <Link className="portal-text-link" href={catalogHref}>{copy.viewCourses}</Link>
        </section>
      ) : <>
        <nav className={styles.breadcrumb} aria-label={detail.breadcrumb}>
          <Link href={`/${locale}/portal`}>{detail.home}</Link><Image src={asset("chevron-right")} alt="" width={12} height={12} />
          <Link href={catalogHref}>{copy.navigation.courses}</Link><Image src={asset("chevron-right")} alt="" width={12} height={12} />
          <Link href={`${catalogHref}?category=${encodeURIComponent(identity.track)}`}>{identity.track}</Link><Image src={asset("chevron-right")} alt="" width={12} height={12} />
          <span aria-current="page">{identity.title}</span>
        </nav>
        <section className={styles.hero}>
          <div className={styles.cover}><CourseThumbnail slug={course?.slug || slug} title={identity.title} src={signedCover} /></div>
          <div className={styles.heroCopy}>
            <p className={styles.tag} data-course-track={identity.track}>{identity.track}</p>
            <h1 data-course-title={identity.title}>{identity.title}</h1>
            <p className={styles.summary}>{course?.subtitle || course?.description || ""}</p>
            <div className={styles.stats} data-preview-available={identity.previewAvailable ? "true" : "false"}>
              <span data-lesson-count={identity.lessonCount}>{identity.lessonCount} {detail.lessons}</span>
              <span data-total-minutes={identity.totalMinutes}>{durationLabel}</span>
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
                <div className={styles.outcomes}>
                  <h3>{detail.outcomesTitle}</h3>
                  <ul>{detail.outcomes.map(outcome => <li key={outcome}>{outcome}</li>)}</ul>
                </div>
              </section>
              <section className={`${styles.card} ${styles.curriculum}`} data-syllabus="true">
                <h2>{detail.curriculum}</h2>
                <details open>
                  <summary>
                    <span className={styles.meta}>
                      <span><Image src={asset("lessons")} alt="" width={20} height={20} />{identity.lessonCount} {detail.lessons}</span>
                      <span><Image src={asset("clock")} alt="" width={20} height={20} />{durationLabel}</span>
                    </span>
                    <span className={styles.toggle}><span className={styles.less}>{detail.less}</span><span className={styles.more}>{detail.more}</span><Image src={asset("chevron-up")} alt="" width={16} height={16} /></span>
                  </summary>
                  <div className={styles.lessonList}>
                    {page.syllabus.map((lesson, index) => {
                      const lessonHref = !course || !lesson.openable ? null : lesson.access === "entitled"
                        ? `/${locale}/account/learn/${course.id}?lessonId=${encodeURIComponent(lesson.lessonId)}`
                        : `/${locale}/portal/courses/${course.id}/public-lesson?lessonId=${encodeURIComponent(lesson.lessonId)}`;
                      const metadata = lessonMetadata.get(lesson.lessonId);
                      return <article className={styles.lesson} key={lesson.lessonId} data-lesson-id={lesson.lessonId} data-lesson-access={lesson.access} data-lesson-openable={lesson.openable ? "true" : "false"}>
                        <div className={styles.lessonMain}>
                          <h3><span>{detail.lesson} {index + 1}</span>{lesson.title}</h3>
                          <div className={styles.lessonDescription}><time>{metadata?.duration || "—"}</time>{metadata?.description ? <p>{metadata.description}</p> : null}</div>
                        </div>
                        <CourseCurriculumAction lesson={lesson} href={lessonHref && !user ? signInHref : lessonHref && needsMode ? `/${locale}/portal/courses/${slug}?lessonEntry=${encodeURIComponent(lesson.lessonId)}` : lessonHref} className={styles.preview} copy={detail} cta={page.cta} actionLessonId={page.actionLessonId} />
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
              {hasCourseAccess ? <section className={styles.planStatus} data-course-plan-status="included">
                <h2><Image src={asset("plan-check")} alt="" width={24} height={24}/>{detail.includedInPlan}</h2>
                {learningHref && <Link className={styles.learningAction} href={learningHref}>{page.openedLearningPointCount > 0 ? detail.continueLearning : detail.startLearning}</Link>}
              </section> : <section className={styles.subscription} data-course-plan-status="purchase">
                <h2>{detail.included}</h2>
                <p className={styles.price}>{price && plan ? <><strong>{price} /</strong><span>{plan.termMonths} {detail.months}</span></> : <span>{messages.pricingDesign.unavailable}</span>}</p>
                <Link className={styles.benefits} href={pricingHref} data-course-cta-link={page.cta === "view_plans" ? "view_plans" : undefined} data-course-secondary-cta={page.secondaryCta || undefined}>{detail.benefits}</Link>
              </section>}
            </aside>
          </section>
        )}
      </>}
      <PortalFooter locale={locale} />
      {course && user && needsMode && entryDestination ? <CourseLearningModeDialog key={`${user.id}:${course.id}:${entryLessonId}`} courseId={course.id} locale={locale} signedIn destinationHref={entryDestination}/> : null}
      </StreamedContent>
    </main>
  );
}

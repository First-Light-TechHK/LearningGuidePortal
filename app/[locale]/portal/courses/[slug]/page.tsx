import Link from "next/link";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import type { CoursePageCta } from "@/lib/coursePage";
import { getCoursePage, getProductCourse } from "@/services/productStore";
import { CourseThumbnail } from "@/components/portal/CourseThumbnail";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { currentProductUser } from "@/services/productAuth";

export default async function CourseDetailPage({
  params
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: rawLocale, slug } = await params;
  const locale = localeFrom(rawLocale);
  const user = await currentProductUser();
  const page = await getCoursePage(slug, user?.id ?? null);
  const course = await getProductCourse(slug);
  const copy = getMessages(locale).portal;
  const learningCopy = getMessages(locale).learning;
  const design = getMessages(locale).overviewDesign;

  function ctaHref(cta: CoursePageCta, lessonId?: string | null) {
    if (!course || !cta) return null;
    if (cta === "continue_learning") return `/${locale}/account/learn/${course.id}`;
    if (cta === "start_preview" || cta === "continue_preview") {
      const target = lessonId || page.nextPreviewLessonId;
      return `/${locale}/portal/courses/${course.id}/public-lesson${target ? `?lessonId=${encodeURIComponent(target)}` : ""}`;
    }
    if (cta === "view_plans") return `/${locale}/pricing?courseId=${encodeURIComponent(course.id)}`;
    return null;
  }

  function syllabusHref(lesson: (typeof page.syllabus)[number]) {
    if (!course || !lesson.openable) return null;
    if (lesson.access === "entitled") return `/${locale}/account/learn/${course.id}`;
    return `/${locale}/portal/courses/${course.id}/public-lesson?lessonId=${encodeURIComponent(lesson.lessonId)}`;
  }

  function ctaLabel(cta: CoursePageCta) {
    if (cta === "continue_learning") return learningCopy.continue;
    if (cta === "continue_preview") return design.continuePreview;
    if (cta === "start_preview") return copy.startPreview;
    if (cta === "view_plans") return learningCopy.viewPlans;
    return null;
  }

  function accessLabel(access: "previewable" | "locked" | "entitled") {
    if (access === "entitled") return copy.entitledLesson;
    if (access === "previewable") return copy.previewableLesson;
    return copy.lockedLesson;
  }

  const href = ctaHref(page.cta);
  const label = ctaLabel(page.cta);
  const secondaryHref = ctaHref(page.secondaryCta);
  const secondaryLabel = ctaLabel(page.secondaryCta);
  const identity = page.identity;
  const catalogHref = `/${locale}/portal/courses`;

  return (
    <main className="portal-page portal-course-detail-page" data-page-state={page.pageState} data-course-cta={page.cta || "none"} data-access-state={page.accessState}>
      <PortalHeader locale={locale} active="courses" signedIn={Boolean(user)} displayName={user?.nickname} avatarUrl={user?.avatarPath ? "/api/my-learning/avatar" : undefined} />
      {page.pageState === "failed" || !identity ? (
        <section className="portal-section portal-section-first" data-course-failed="true">
          <h1>{copy.courseUnavailable}</h1>
          <p>{copy.courseUnavailableDescription}</p>
          <Link className="portal-text-link" href={catalogHref}>{copy.viewCourses}</Link>
        </section>
      ) : (
        <>
          <section className="course-detail-hero">
            <div className="course-detail-hero-image"><CourseThumbnail slug={course?.slug || slug} title={identity.title} /></div>
            <div className="course-detail-hero-copy">
              <p className="portal-course-tag" data-course-track={identity.track}>{identity.track}</p>
              <h1 data-course-title={identity.title}>{identity.title}</h1>
              <p>{course?.description || ""}</p>
              <div className="course-detail-stats">
                <span data-lesson-count={identity.lessonCount}>{identity.lessonCount} {copy.lessons.toLowerCase()}</span>
                <span data-total-minutes={identity.totalMinutes}>{identity.totalMinutes} {learningCopy.minutes}</span>
                <span data-preview-available={identity.previewAvailable ? "true" : "false"}>{identity.previewAvailable ? design.previewAvailable : learningCopy.viewPlans}</span>
              </div>
            </div>
          </section>
          {page.pageState === "withdrawn" ? (
            <section className="portal-course-detail-body">
              <p className="course-withdrawn-label" data-course-withdrawn="true">{learningCopy.courseWithdrawn}</p>
            </section>
          ) : (
            <section className="portal-course-detail-body">
              <div>
                <div className="portal-detail-intro">
                  <p className="portal-eyebrow">{copy.courseDetail}</p>
                  <h2>{copy.whatYouWillLearn}</h2>
                  <p>{course?.description || ""}</p>
                </div>
                <div className="course-lesson-index" data-syllabus="true">
                  <h2>{copy.lessons || "Lessons"}</h2>
                  {page.syllabus.map((lesson, index) => {
                    const lessonHref = syllabusHref(lesson);
                    return (
                      <div className="course-lesson-row" key={lesson.lessonId} data-lesson-id={lesson.lessonId} data-lesson-access={lesson.access} data-lesson-openable={lesson.openable ? "true" : "false"}>
                        <div>
                          {lessonHref ? <Link href={lessonHref}><strong>{index + 1}. {lesson.title}</strong></Link> : <strong>{index + 1}. {lesson.title}</strong>}
                        </div>
                        <span className={lesson.access === "locked" ? "lesson-access-locked" : "lesson-access-open"}>{accessLabel(lesson.access)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <aside className="course-detail-aside">
                {href && label ? (
                  <div className="course-access-card">
                    <p className="portal-eyebrow">{identity.track}</p>
                    <strong>{label}</strong>
                    <Link className="portal-button portal-button-primary" data-course-cta-link={page.cta || ""} href={href}>{label}</Link>
                    {secondaryHref && secondaryLabel ? <Link className="portal-button portal-button-secondary" data-course-secondary-cta={page.secondaryCta || ""} href={secondaryHref}>{secondaryLabel}</Link> : null}
                  </div>
                ) : null}
              </aside>
            </section>
          )}
        </>
      )}
      <PortalFooter locale={locale} />
    </main>
  );
}

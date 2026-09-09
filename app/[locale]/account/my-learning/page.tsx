import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountNav } from "@/components/portal/AccountNav";
import { CourseThumbnail } from "@/components/portal/CourseThumbnail";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import type { OverviewCta } from "@/lib/myLearningOverview";
import { currentProductUser } from "@/services/productAuth";
import { getLearningOverview, getPortalContent } from "@/services/productStore";

export default async function MyLearningPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=/${locale}/account/my-learning`);

  const overview = await getLearningOverview(user.id);
  const copy = getMessages(locale).learning;
  const messages = getMessages(locale);

  const design = messages.overviewDesign;
  const content = await getPortalContent();
  const categoryLabel = (id: string) => content.categories.find((category) => category.id === id)?.labels[locale] || id;
  const accessLabels = overview.entitlements.map((entitlement) => {
    if (entitlement.scope === "everything" || entitlement.courseId === "*") return messages.pricingDesign.everything;
    if (entitlement.scope === "category") return categoryLabel(entitlement.scopeId || entitlement.courseId);
    return overview.courses.find((course) => course.courseId === entitlement.courseId)?.courseTitle
      || overview.subscriptions.find((subscription) => subscription.plan?.courseId === entitlement.courseId)?.plan?.name
      || entitlement.courseId;
  });
  const hasEverything = overview.entitlements.some((entitlement) => entitlement.scope === "everything" || entitlement.courseId === "*");
  const access = accessLabels.length
    ? design.currentAccess.replace("{scope}", hasEverything ? messages.pricingDesign.everything : [...new Set(accessLabels)].join(" · "))
    : design.noAccess;

  function ctaHref(item: (typeof overview.courses)[number], cta: OverviewCta) {
    if (cta === "continue_learning" || cta === "review_course") return `/${locale}/account/learn/${item.courseId}`;
    if (cta === "continue_preview") {
      const lessonId = item.nextPreviewLessonId || item.currentLessonId;
      return `/${locale}/portal/courses/${item.courseId}/public-lesson${lessonId ? `?lessonId=${encodeURIComponent(lessonId)}` : ""}`;
    }
    if (cta === "view_course") return `/${locale}/portal/courses/${item.courseId}`;
    if (cta === "view_plans") return `/${locale}/pricing?courseId=${encodeURIComponent(item.courseId)}`;
    if (cta === "browse_courses") return `/${locale}/portal/courses`;
    return null;
  }

  function ctaLabel(cta: OverviewCta) {
    if (cta === "continue_learning") return design.continue;
    if (cta === "review_course") return design.review;
    if (cta === "continue_preview") return design.continuePreview;
    if (cta === "view_plans") return copy.viewPlans;
    if (cta === "view_course") return messages.portal.viewCourse;
    if (cta === "browse_courses") return messages.portal.viewCourses;
    return null;
  }

  function stateLabel(item: (typeof overview.courses)[number]) {
    if (item.cardState === "previewing") return design.previewAvailable;
    if (item.cardState === "preview_limit") return design.previewLimit;
    if (item.cardState === "completed") return copy.completed;
    if (item.cardState === "progress_failed") return design.progressUnavailable;
    if (item.cardState === "no_access_history") return design.outsideAccess;
    return copy.inProgress;
  }

  const emptyCopy = overview.emptyState === "no_preview" ? copy.noPreviewCourses : copy.noCourses;

  return (
    <main className="portal-page portal-account-page overview-design-page">
      <PortalHeader locale={locale} active="my-learning" signedIn displayName={user.nickname} avatarUrl={user.avatarPath ? "/api/my-learning/avatar" : undefined} />
      <AccountNav locale={locale} copy={messages.account} />
      <section className="account-dashboard" aria-labelledby="my-learning-heading">
        <div className="overview-heading"><div><h1 id="my-learning-heading">{design.welcome.replace("{name}", user.nickname)}</h1><p>{design.description}</p></div><span className="overview-access">{access}</span></div>
        <section aria-labelledby="continue-heading">
          <div className="overview-section-heading"><h2 id="continue-heading">{design.yourLearning}</h2><p>{design.courseStates}</p></div>
          {overview.courses.length ? <div className="account-learning-list">{overview.courses.map((item) => {
            const label = ctaLabel(item.cta);
            const href = ctaHref(item, item.cta);
            const primary = item.cta === "continue_learning" || item.cta === "continue_preview";
            return <article className="account-learning-card overview-course" key={item.id}>
              <CourseThumbnail slug={item.courseId} title={item.courseTitle} />
              <div className="account-learning-card-content">
                <h3>{item.courseTitle}</h3>
                {item.cardState === "withdrawn" ? <p className="course-withdrawn-label">{copy.courseWithdrawn}</p> : <>
                  <p className="overview-course-meta">{categoryLabel(item.courseCategory)} · {item.lessonCount} {copy.lessons.toLowerCase()} · {stateLabel(item)}</p>
                  <p className="overview-course-description" title={item.cardState === "learning" || item.cardState === "completed" ? item.courseDescription : item.cardState === "previewing" ? design.previewDescription : item.cardState === "progress_failed" ? design.progressUnavailable : design.outsideAccess}>{item.cardState === "learning" || item.cardState === "completed" ? item.courseDescription : item.cardState === "previewing" ? design.previewDescription : item.cardState === "preview_limit" ? design.previewLimit : item.cardState === "progress_failed" ? design.progressUnavailable : design.outsideAccess}</p>
                  {item.progressFailed || item.progress == null ? null : <>
                    <div className="overview-course-progress" role="progressbar" aria-label={`${item.courseTitle}: ${copy.progress}`} aria-valuenow={item.progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${item.progress}%` }} /></div>
                    <div className="overview-progress-labels"><span>{item.cardState === "completed" ? copy.completed : `${item.progress}%`}</span><span>{item.cardState === "completed" ? copy.completed : item.currentLessonTitle ? `${copy.currentLesson}: ${item.currentLessonTitle}` : copy.inProgress}</span></div>
                  </>}
                </>}
              </div>
              {href && label ? <Link className={`portal-button ${primary ? "portal-button-primary" : "portal-button-secondary"} account-learning-action`} href={href}>{label}</Link> : null}
            </article>;
          })}</div> : <div className="account-empty-state"><p>{emptyCopy}</p><Link prefetch={false} className="portal-button portal-button-primary" href={`/${locale}/portal/courses`}>{messages.portal.viewCourses}</Link></div>}
          {overview.courses.length ? <p className="overview-list-caption">{design.allCourses}</p> : null}
        </section>
      </section>
      <PortalFooter locale={locale} />
    </main>
  );
}

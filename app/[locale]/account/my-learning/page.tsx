import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountNav } from "@/components/portal/AccountNav";
import { CourseThumbnail } from "@/components/portal/CourseThumbnail";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
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
  return (
    <main className="portal-page portal-account-page overview-design-page">
      <PortalHeader locale={locale} active="my-learning" signedIn displayName={user.nickname} avatarUrl={user.avatarPath ? "/api/my-learning/avatar" : undefined} />
      <AccountNav locale={locale} copy={messages.account} />
      <section className="account-dashboard" aria-labelledby="my-learning-heading">
        <div className="overview-heading"><div><h1 id="my-learning-heading">{design.welcome.replace("{name}", user.nickname)}</h1><p>{design.description}</p></div><span className="overview-access">{access}</span></div>
        <section aria-labelledby="continue-heading">
          <div className="overview-section-heading"><h2 id="continue-heading">{design.yourLearning}</h2><p>{design.courseStates}</p></div>
          {overview.courses.length ? <div className="account-learning-list">{overview.courses.map((item) => {
            const withdrawn = item.courseStatus !== "published";
            const canStudy = Boolean(item.entitlement) && !withdrawn;
            const canPreview = !canStudy && !withdrawn && Boolean(item.nextPreviewLessonId);
            const previewLimit = !canStudy && item.previewAvailable && !item.nextPreviewLessonId;
            const completed = Boolean(item.completedAt) || item.progress === 100;
            const progress = Math.max(0, Math.min(100, item.progress));
            const current = completed ? copy.completed : item.currentLessonTitle ? `${copy.currentLesson}: ${item.currentLessonTitle}` : copy.inProgress;
            return <article className="account-learning-card overview-course" key={item.id}>
              <CourseThumbnail slug={item.courseId} title={item.courseTitle} />
              <div className="account-learning-card-content">
                <h3>{item.courseTitle}</h3>
                {withdrawn ? <p className="course-withdrawn-label">{copy.courseWithdrawn}</p> : <>
                  <p className="overview-course-meta">{categoryLabel(item.courseCategory)} · {item.lessonCount} {copy.lessons.toLowerCase()} · {canPreview ? design.previewAvailable : previewLimit ? design.previewLimit : completed ? copy.completed : copy.inProgress}</p>
                  <p className="overview-course-description" title={canStudy ? item.courseDescription : canPreview ? design.previewDescription : design.outsideAccess}>{canStudy ? item.courseDescription : canPreview ? design.previewDescription : previewLimit ? design.previewLimit : design.outsideAccess}</p>
                  <div className="overview-course-progress" role="progressbar" aria-label={`${item.courseTitle}: ${copy.progress}`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>
                  <div className="overview-progress-labels"><span>{completed ? copy.completed : `${progress}%`}</span><span>{current}</span></div>
                </>}
              </div>
              {!withdrawn ? <Link className={`portal-button ${(canStudy && !completed) || canPreview ? "portal-button-primary" : "portal-button-secondary"} account-learning-action`} href={canStudy ? `/${locale}/account/learn/${item.courseId}` : canPreview ? `/${locale}/portal/courses/${item.courseId}/public-lesson?lessonId=${encodeURIComponent(item.nextPreviewLessonId!)}` : `/${locale}/pricing?courseId=${encodeURIComponent(item.courseId)}`}>{canStudy ? completed ? design.review : design.continue : canPreview ? design.continuePreview : copy.viewPlans}</Link> : null}
            </article>;
          })}</div> : <div className="account-empty-state"><p>{copy.noCourses}</p><Link className="portal-button portal-button-primary" href={`/${locale}/portal/courses`}>{messages.portal.viewCourses}</Link></div>}
          {overview.courses.length ? <p className="overview-list-caption">{design.allCourses}</p> : null}
        </section>
      </section>
      <PortalFooter locale={locale} />
    </main>
  );
}

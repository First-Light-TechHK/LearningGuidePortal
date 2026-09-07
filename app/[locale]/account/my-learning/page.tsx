import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountNav } from "@/components/portal/AccountNav";
import { CourseThumbnail } from "@/components/portal/CourseThumbnail";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { SubscriptionManager } from "@/components/portal/SubscriptionManager";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { currentProductUser } from "@/services/productAuth";
import { getLearningOverview } from "@/services/productStore";

export default async function MyLearningPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=/${locale}/account/my-learning`);

  const overview = await getLearningOverview(user.id);
  const copy = getMessages(locale).learning;
  const messages = getMessages(locale);
  const activeCourses = overview.courses.filter((course) => course.entitlement).length;
  const totalLessons = overview.courses.reduce((total, course) => total + course.lessonCount, 0);

  return (
    <main className="portal-page portal-account-page">
      <PortalHeader locale={locale} active="my-learning" signedIn displayName={user.nickname} avatarUrl={user.avatarPath ? "/api/my-learning/avatar" : undefined} />
      <AccountNav locale={locale} copy={messages.account} />
      <section className="account-dashboard" aria-labelledby="my-learning-heading">
        <div className="account-dashboard-main">
          <div className="account-page-heading"><p className="portal-eyebrow">{copy.title}</p><h1 id="my-learning-heading">{copy.title}</h1></div>
          <section className="account-panel" aria-labelledby="continue-heading">
            <div className="account-panel-heading"><div><h2 id="continue-heading">{locale === "en-GB" ? "Continue Learning" : "继续学习"}</h2><p>{locale === "en-GB" ? "Pick up where you left off." : "从上次学习的位置继续。"}</p></div><Link className="portal-text-link" href={`/${locale}/portal/courses`}>{locale === "en-GB" ? "Browse Courses" : "浏览课程"}</Link></div>
            {overview.courses.length ? <div className="account-learning-list">{overview.courses.map((item) => { const withdrawn = item.courseStatus !== "published"; const canStudy = Boolean(item.entitlement) && !withdrawn; const isComplete = item.completedAt !== null || item.progress === 100; const actionLabel = withdrawn ? copy.courseWithdrawn : canStudy ? (isComplete ? copy.review : copy.continue) : copy.viewPlans; return <article className="account-learning-card" key={item.id}><CourseThumbnail slug={item.courseId} title={item.courseTitle} /><div className="account-learning-card-content"><div className="account-learning-card-title"><div><h3>{item.courseTitle}</h3><span className="course-category-label">{item.courseCategory}</span>{item.courseDescription ? <p>{item.courseDescription}</p> : null}</div><span className={`account-status ${withdrawn ? "expired" : isComplete ? "complete" : canStudy ? "active" : "expired"}`}>{withdrawn ? copy.courseWithdrawn : isComplete ? copy.completed : canStudy ? copy.inProgress : copy.expired}</span></div><p className="account-learning-meta">{item.lessonCount} {copy.lessons.toLowerCase()} · {item.totalMinutes} {messages.portal.minutesShort} · {copy.progress}: {item.progress}%{item.currentLessonTitle ? ` · ${copy.currentLesson}: ${item.currentLessonTitle}` : ""}</p><div className="progress-track"><span style={{ width: `${item.progress}%` }} /></div>{withdrawn ? <span className="course-withdrawn-label">{copy.courseWithdrawn}</span> : <Link className="portal-button portal-button-primary account-learning-action" href={canStudy ? `/${locale}/account/learn/${item.courseId}` : `/${locale}/pricing?courseId=${encodeURIComponent(item.courseId)}`}>{actionLabel}</Link>}</div></article>; })}</div> : <div className="account-empty-state"><p>{copy.noCourses}</p><Link className="portal-button portal-button-primary" href={`/${locale}/portal/courses`}>{messages.portal.viewCourses}</Link></div>}
          </section>
        </div>
        <aside className="account-dashboard-side">
          <section className="account-profile-card"><div className="account-avatar">{user.avatarPath ? <img src="/api/my-learning/avatar" alt="" /> : user.nickname.slice(0, 1).toUpperCase()}</div><p>{locale === "en-GB" ? "Welcome back," : "欢迎回来，"}</p><h2>{user.nickname}</h2><span>{user.email}</span><div className="account-stat-grid"><div><strong>{activeCourses}</strong><span>{locale === "en-GB" ? "Active courses" : "有效课程"}</span></div><div><strong>{overview.orders.length}</strong><span>{locale === "en-GB" ? "Payment records" : "支付记录"}</span></div><div><strong>{totalLessons}</strong><span>{copy.lessons}</span></div></div></section>
          <section className="account-panel account-subscription-panel"><SubscriptionManager initialSubscriptions={overview.subscriptions} initialOrders={overview.orders} locale={locale} copy={{ title: copy.subscription, active: copy.active, trial: copy.trial, grace: copy.grace, cancelAtPeriodEnd: copy.cancelAtPeriodEnd, canceled: copy.canceled, expired: copy.expired, cancel: copy.cancel, resume: copy.resume, manage: copy.manage, validUntil: copy.validUntil, records: copy.records, date: copy.date, amount: copy.amount, receipt: copy.receipt, noReceipt: copy.noReceipt, paid: copy.paid, pending: copy.pending, failed: copy.failed, canceledPayment: copy.canceledPayment, refunded: copy.refunded, trialActivation: copy.trialActivation, cancelTitle: copy.cancelTitle, cancelDescription: copy.cancelDescription, cancelReason: copy.cancelReason, reasonLowUsage: copy.reasonLowUsage, reasonTooExpensive: copy.reasonTooExpensive, reasonContent: copy.reasonContent, reasonWebsite: copy.reasonWebsite, reasonOther: copy.reasonOther, reasonOtherPlaceholder: copy.reasonOtherPlaceholder, characters: copy.characters, confirmCancel: copy.confirmCancel, close: copy.close, updatePaymentMethod: copy.updatePaymentMethod, payNow: copy.payNow, plan: copy.plan, validPeriod: copy.validPeriod, upgrade: copy.upgrade }} /></section>
        </aside>
      </section>
      <PortalFooter locale={locale} />
    </main>
  );
}

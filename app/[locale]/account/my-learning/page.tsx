import Link from "next/link";
import { redirect } from "next/navigation";
import { currentProductUser } from "@/services/productAuth";
import { getLearningOverview } from "@/services/productStore";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { SignOutButton } from "@/components/portal/SignOutButton";
import { SubscriptionManager } from "@/components/portal/SubscriptionManager";
import { AccountNav } from "@/components/portal/AccountNav";

export default async function MyLearningPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = localeFrom(rawLocale);
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=/${locale}/account/my-learning`);
  const overview = await getLearningOverview(user.id);
  const copy = getMessages(locale).learning;
  const messages = getMessages(locale);
  return <main className="portal-page portal-page-narrow"><header className="portal-header"><Link className="portal-brand" href={`/${locale}/portal`}><span className="portal-brand-mark">LG</span><span>{messages.brand}</span></Link><SignOutButton label={copy.signOut} locale={locale} /></header><AccountNav locale={locale} copy={messages.account} /><section className="portal-section portal-section-first"><p className="portal-eyebrow">{copy.title}</p><h1>{copy.title}</h1><div className="user-summary"><strong>{user.nickname}</strong><span>{user.email}</span></div><div className="learning-list">{overview.courses.length ? overview.courses.map((item) => { const canStudy = Boolean(item.entitlement); const isComplete = item.completedAt !== null || item.progress === 100; const actionLabel = canStudy ? (isComplete ? copy.review : copy.continue) : copy.viewPlans; return <article className="learning-card" key={item.id}><div><h2>{item.courseTitle}</h2>{item.courseDescription ? <p className="learning-description">{item.courseDescription}</p> : null}<p>{isComplete ? copy.completed : canStudy ? copy.inProgress : copy.expired} · {copy.progress}: {item.progress}% · {item.lessonCount} {copy.lessons.toLowerCase()}</p>{item.currentLessonTitle ? <p className="learning-current">{copy.currentLesson}: {item.currentLessonTitle}</p> : null}<div className="progress-track"><span style={{ width: `${item.progress}%` }} /></div></div><Link className="portal-button portal-button-primary" href={canStudy ? `/${locale}/account/learn/${item.courseId}` : `/${locale}/pricing?courseId=${encodeURIComponent(item.courseId)}`}>{actionLabel}</Link></article>; }) : <p className="portal-empty">{copy.noCourses}</p>}</div><SubscriptionManager initialSubscriptions={overview.subscriptions} initialOrders={overview.orders} locale={locale} copy={{ title: copy.subscription, active: copy.active, trial: copy.trial, grace: copy.grace, cancelAtPeriodEnd: copy.cancelAtPeriodEnd, canceled: copy.canceled, expired: copy.expired, cancel: copy.cancel, resume: copy.resume, manage: copy.manage, validUntil: copy.validUntil, records: copy.records, date: copy.date, amount: copy.amount, receipt: copy.receipt, noReceipt: copy.noReceipt, paid: copy.paid, pending: copy.pending, failed: copy.failed, canceledPayment: copy.canceledPayment, refunded: copy.refunded, trialActivation: copy.trialActivation }} /><h2 className="learning-subheading">{copy.notifications}</h2><div className="notification-list">{overview.notifications.slice(0, 3).map((notification) => <div className="notification-row" key={notification.id}><strong>{notification.title}</strong><span>{notification.body}</span></div>)}</div><Link className="portal-text-link" href={`/${locale}/account/my-learning/notifications`}>{messages.notificationsPage.viewAll}</Link></section></main>;
}

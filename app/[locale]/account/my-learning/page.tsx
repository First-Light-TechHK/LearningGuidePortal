import Link from "next/link";
import { redirect } from "next/navigation";
import { currentProductUser } from "@/services/productAuth";
import { getLearningOverview } from "@/services/productStore";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { SignOutButton } from "@/components/portal/SignOutButton";
import { SubscriptionManager } from "@/components/portal/SubscriptionManager";

export default async function MyLearningPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = localeFrom(rawLocale);
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=/${locale}/account/my-learning`);
  const overview = await getLearningOverview(user.id);
  const copy = getMessages(locale).learning;
  return <main className="portal-page portal-page-narrow"><header className="portal-header"><Link className="portal-brand" href={`/${locale}/portal`}><span className="portal-brand-mark">LG</span><span>{getMessages(locale).brand}</span></Link><SignOutButton label={copy.signOut} locale={locale} /></header><section className="portal-section portal-section-first"><p className="portal-eyebrow">{copy.title}</p><h1>{copy.title}</h1><div className="learning-list">{overview.courses.length ? overview.courses.map((item) => <article className="learning-card" key={item.id}><div><h2>{item.courseTitle}</h2><p>{copy.progress}: {item.progress}%</p><div className="progress-track"><span style={{ width: `${item.progress}%` }} /></div></div><Link className="portal-button portal-button-primary" href={`/${locale}/account/learn/${item.courseId}`}>{copy.continue}</Link></article>) : <p className="portal-empty">{copy.noCourses}</p>}</div><SubscriptionManager initialSubscriptions={overview.subscriptions} copy={{ title: copy.subscription, active: copy.active, trial: copy.trial, cancelAtPeriodEnd: copy.cancelAtPeriodEnd, canceled: copy.canceled, expired: copy.expired, cancel: copy.cancel, resume: copy.resume, validUntil: copy.validUntil }} /><h2 className="learning-subheading">{copy.notifications}</h2><div className="notification-list">{overview.notifications.map((notification) => <div className="notification-row" key={notification.id}><strong>{notification.title}</strong><span>{notification.body}</span></div>)}</div></section></main>;
}

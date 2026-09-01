import Link from "next/link";
import { redirect } from "next/navigation";
import { currentProductUser } from "@/services/productAuth";
import { getLearningOverview } from "@/services/productStore";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { AccountNav } from "@/components/portal/AccountNav";
import { NotificationList } from "@/components/portal/NotificationList";
import { SignOutButton } from "@/components/portal/SignOutButton";

export default async function NotificationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = localeFrom(rawLocale);
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=/${locale}/account/my-learning/notifications`);
  const messages = getMessages(locale);
  const overview = await getLearningOverview(user.id);
  return <main className="portal-page portal-page-narrow"><header className="portal-header"><Link className="portal-brand" href={`/${locale}/portal`}><span className="portal-brand-mark">LG</span><span>{messages.brand}</span></Link><SignOutButton label={messages.learning.signOut} locale={locale} /></header><AccountNav locale={locale} copy={messages.account} /><section className="portal-section portal-section-first"><p className="portal-eyebrow">{messages.account.notifications}</p><h1>{messages.notificationsPage.title}</h1><NotificationList initialNotifications={overview.notifications} copy={messages.notificationsPage} /></section></main>;
}

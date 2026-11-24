import { redirect } from "next/navigation";
import { currentProductUser } from "@/services/productAuth";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { listLearnerNotifications } from "@/services/notifications/service";
import { AccountNav } from "@/components/portal/AccountNav";
import { NotificationList } from "@/components/portal/NotificationList";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";

export default async function NotificationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=/${locale}/account/my-learning/notifications`);
  const messages = getMessages(locale);
  // The same service call the GET route makes, so the first render and later fetches agree.
  const initial = await listLearnerNotifications(user.id, { filter: "all", limit: 20, language: locale === "zh-CN" ? "zh" : "en" });
  return <main className="portal-page portal-account-page notification-design-page"><PortalHeader locale={locale} active="my-learning" signedIn displayName={user.nickname} avatarUrl={user.avatarPath ? "/api/my-learning/avatar" : undefined} /><AccountNav locale={locale} copy={messages.account} /><section className="portal-section portal-section-first"><h1>{messages.notificationsPage.title}</h1><p className="subscription-page-intro">{messages.notificationsPage.intro}</p><NotificationList locale={locale} initial={initial} copy={messages.notificationsPage} /></section><PortalFooter locale={locale} /></main>;
}

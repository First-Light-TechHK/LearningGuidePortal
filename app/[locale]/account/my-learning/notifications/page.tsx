import { redirect } from "next/navigation";
import { currentProductUser } from "@/services/productAuth";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { AccountNav } from "@/components/portal/AccountNav";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";

export default async function NotificationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=/${locale}/account/my-learning/notifications`);
  const messages = getMessages(locale);
  return <main className="portal-page portal-account-page"><PortalHeader locale={locale} active="my-learning" signedIn displayName={user.nickname} avatarUrl={user.avatarPath ? "/api/my-learning/avatar" : undefined} /><AccountNav locale={locale} copy={messages.account} /><section className="portal-section portal-section-first public-placeholder-page"><p className="portal-eyebrow">{messages.account.notifications}</p><h1>{messages.notificationsPage.title}</h1><p>{messages.notificationsPage.placeholder}</p></section><PortalFooter locale={locale} /></main>;
}

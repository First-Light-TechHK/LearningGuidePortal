import { redirect } from "next/navigation";
import { AccountNav } from "@/components/portal/AccountNav";
import { OverviewDesign } from "@/components/portal/OverviewDesign";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { currentProductUser } from "@/services/productAuth";
import { getOverviewDisplay } from "@/services/overviewDisplay";
import styles from "@/components/portal/overview-design.module.css";

export default async function MyLearningPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=/${locale}/account/my-learning`);
  const data = await getOverviewDisplay(user.id, user.nickname, locale);
  const messages = getMessages(locale);
  return <main className={`portal-page portal-account-page ${styles.page}`}>
    <PortalHeader locale={locale} active="my-learning" signedIn displayName={user.nickname} avatarUrl={user.avatarPath ? "/api/my-learning/avatar" : undefined}/>
    <AccountNav locale={locale} copy={messages.account}/>
    <OverviewDesign data={data} locale={locale}/>
    <PortalFooter locale={locale}/>
  </main>;
}

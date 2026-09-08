import { getPortalContent, socialProvidersForUser } from "@/services/productStore";
import { redirect } from "next/navigation";
import { currentProductUser } from "@/services/productAuth";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { AccountNav } from "@/components/portal/AccountNav";
import { SettingsForm } from "@/components/portal/SettingsForm";
import { SocialSignInCard } from "@/components/portal/SocialSignInCard";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { googleEnabled } from "@/services/oauthService";

export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = localeFrom(rawLocale);
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=/${locale}/account/my-learning/settings`);
  const messages = getMessages(locale);
  const content = await getPortalContent();
  const providers = await socialProvidersForUser(user.id);
  return <main className="portal-page portal-account-page settings-design-page"><PortalHeader locale={locale} active="my-learning" signedIn displayName={user.nickname} avatarUrl={user.avatarPath ? "/api/my-learning/avatar" : undefined} /><AccountNav locale={locale} copy={messages.account} /><section className="portal-section portal-section-first account-settings-page"><h1>{messages.settingsPage.title}</h1><p className="settings-page-intro">{messages.settingsDesign.intro}</p><SettingsForm uiLocale={locale} countries={content.countries} initialNickname={user.nickname} initialEmail={user.email} initialLocale={user.locale} initialCountry={user.country} initialAgeRange={user.ageRange} initialEducation={user.education} initialAreasOfInterest={user.areasOfInterest} hasAvatar={Boolean(user.avatarPath)} copy={messages.settingsPage} />{googleEnabled() ? <SocialSignInCard locale={locale} linked={providers.includes("google")} copy={messages.settingsPage} /> : null}</section><PortalFooter locale={locale} /></main>;
}

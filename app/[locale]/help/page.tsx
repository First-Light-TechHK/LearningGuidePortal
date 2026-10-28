import { HelpCentre } from "@/components/helpdesk/HelpCentre";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { parseHelpCentreQuery } from "@/contracts/helpdesk";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { createAdminHelpdeskClient } from "@/modules/helpdesk/adminClient";
import { contactSupportHref, loadHelpCentre } from "@/modules/helpdesk/helpCentre";
import { currentProductUser } from "@/services/productAuth";

export const dynamic = "force-dynamic";

/** Public Help Centre (Figma 1387:2): Admin's FAQs, searchable (?q=), by topic (?category=), deep-linkable (?faq=). */
export default async function PublicHelpPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = localeFrom((await params).locale);
  const query = parseHelpCentreQuery(await searchParams);
  const messages = getMessages(locale);
  const [user, view] = await Promise.all([
    currentProductUser(),
    loadHelpCentre(createAdminHelpdeskClient(), locale, query, messages.helpPage.design.faqItems)
  ]);
  return <main className="portal-page help-centre-page">
    <PortalHeader locale={locale} signedIn={Boolean(user)} displayName={user?.nickname} avatarUrl={user?.avatarPath ? "/api/my-learning/avatar" : undefined} />
    <HelpCentre locale={locale} copy={messages.helpCentre} view={view} contactHref={contactSupportHref(locale, Boolean(user))} />
    <PortalFooter locale={locale} />
  </main>;
}

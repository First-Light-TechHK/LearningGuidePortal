import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { currentProductUser } from "@/services/productAuth";
import { HelpCenter } from "./HelpCenter";

export default async function PublicHelpPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const messages = getMessages(locale);
  return <main className="portal-page help-design-page"><PortalHeader locale={locale} signedIn={Boolean(await currentProductUser())} /><HelpCenter locale={locale} copy={messages.helpPage.design} /><PortalFooter locale={locale} /></main>;
}

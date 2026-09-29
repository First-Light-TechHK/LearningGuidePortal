import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { currentProductUser } from "@/services/productAuth";
import { ContactForm } from "./ContactForm";

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const messages = getMessages(locale);
  return <main className="portal-page contact-design-page"><PortalHeader locale={locale} signedIn={Boolean(await currentProductUser())} /><ContactForm copy={messages.contactPage} /><PortalFooter locale={locale} /></main>;
}

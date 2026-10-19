import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { currentProductUser } from "@/services/productAuth";
import { ContactForm } from "./ContactForm";

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const messages = getMessages(locale);
  const user = await currentProductUser();
  return <main className="portal-page contact-design-page"><PortalHeader locale={locale} signedIn={Boolean(user)} displayName={user?.nickname} avatarUrl={user?.avatarPath ? "/api/my-learning/avatar" : undefined} /><ContactForm copy={messages.contactPage} /><PortalFooter locale={locale} /></main>;
}

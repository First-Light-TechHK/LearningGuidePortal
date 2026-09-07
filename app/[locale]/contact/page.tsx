import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { currentProductUser } from "@/services/productAuth";

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const messages = getMessages(locale);
  return <main className="portal-page"><PortalHeader locale={locale} signedIn={Boolean(await currentProductUser())} /><section className="portal-section portal-section-first public-placeholder-page"><p className="portal-eyebrow">{messages.portal.footerContact}</p><h1>{messages.portal.footerContact}</h1><p>{locale === "en-GB" ? "Customer service contact will be available here." : "客户服务入口将在这里提供。"}</p></section><PortalFooter locale={locale} /></main>;
}

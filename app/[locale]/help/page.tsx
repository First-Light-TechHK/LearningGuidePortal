import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { currentProductUser } from "@/services/productAuth";

export default async function PublicHelpPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const messages = getMessages(locale);
  return <main className="portal-page"><PortalHeader locale={locale} signedIn={Boolean(await currentProductUser())} /><section className="portal-section portal-section-first public-placeholder-page"><p className="portal-eyebrow">{messages.account.help}</p><h1>{messages.helpPage.title}</h1><p>{locale === "en-GB" ? "Help content is being prepared." : "帮助内容正在准备中。"}</p></section><PortalFooter locale={locale} /></main>;
}

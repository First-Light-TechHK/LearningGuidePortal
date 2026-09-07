import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { CookiePolicyControls } from "@/components/portal/CookiePolicyControls";
import { currentProductUser } from "@/services/productAuth";

export default async function CookiePolicyPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const messages = getMessages(locale);
  return <main className="portal-page portal-page-narrow"><PortalHeader locale={locale} signedIn={Boolean(await currentProductUser())} /><article className="legal-page portal-section portal-section-first"><p className="portal-eyebrow">{messages.portal.footerCookies}</p><h1>{messages.legal.cookiesTitle}</h1><p className="portal-lead">{messages.legal.cookiesIntro}</p><CookiePolicyControls copy={messages.legal} /></article><PortalFooter locale={locale} /></main>;
}

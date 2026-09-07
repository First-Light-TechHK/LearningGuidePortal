import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { currentProductUser } from "@/services/productAuth";

export default async function TermsOfServicePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const messages = getMessages(locale);
  return <main className="portal-page portal-page-narrow"><PortalHeader locale={locale} signedIn={Boolean(await currentProductUser())} /><article className="legal-page portal-section portal-section-first"><p className="portal-eyebrow">{messages.portal.footerTerms}</p><h1>{messages.legal.termsTitle}</h1><p className="portal-lead">{messages.legal.termsIntro}</p>{messages.legal.termsBody.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</article><PortalFooter locale={locale} /></main>;
}

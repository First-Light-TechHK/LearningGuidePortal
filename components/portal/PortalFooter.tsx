import Link from "next/link";
import { getPortalContent } from "@/services/productStore";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

export async function PortalFooter({ locale }: { locale: Locale }) {
  const content = await getPortalContent();
  const copy = getMessages(locale).portal;
  return (
    <footer className="portal-footer">
      <div className="portal-footer-grid">
        <div><h2>{getMessages(locale).brand}</h2><p>{copy.footerAbout}</p></div>
        <div><h2>{copy.navigation.courses}</h2>{content.categories.map((category) => <Link key={category.id} href={`/${locale}/portal/courses?category=${encodeURIComponent(category.id)}`}>{category.labels[locale]}</Link>)}</div>
        <div><h2>{copy.footerSupport}</h2><Link href={`/${locale}/help`}>{copy.footerHelp}</Link><Link href={`/${locale}/contact`}>{copy.footerContact}</Link><Link href={`/${locale}/cookie-policy`}>{copy.footerCookies}</Link></div>
        <div><h2>{copy.footerLegal}</h2><Link href={`/${locale}/privacy-policy`}>{copy.footerPrivacy}</Link><Link href={`/${locale}/terms-of-service`}>{copy.footerTerms}</Link><p className="portal-footer-copyright">{copy.footerCopyright}</p></div>
      </div>
      <div className="portal-footer-bottom"><p className="portal-footer-social"><span>Instagram</span><span>LinkedIn</span><span>YouTube</span></p></div>
    </footer>
  );
}

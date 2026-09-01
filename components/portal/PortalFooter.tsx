import Link from "next/link";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

export function PortalFooter({ locale }: { locale: Locale }) {
  const copy = getMessages(locale).portal;
  return (
    <footer className="portal-footer">
      <div className="portal-footer-grid">
        <div><h2>{getMessages(locale).brand}</h2><p>{copy.footerAbout}</p></div>
        <div><h2>{copy.footerLinks}</h2><Link href={`/${locale}/portal/courses`}>{copy.navigation.courses}</Link><Link href={`/${locale}/portal/faq`}>{copy.navigation.studyGroups}</Link><Link href={`/${locale}/portal/faq`}>{copy.navigation.inPerson}</Link></div>
        <div><h2>{copy.footerSupport}</h2><Link href={`/${locale}/portal/faq`}>{copy.footerHelp}</Link><Link href={`/${locale}/portal/faq`}>{copy.footerContact}</Link><Link href={`/${locale}/portal/faq`}>{copy.footerPrivacy}</Link><Link href={`/${locale}/portal/faq`}>{copy.footerTerms}</Link></div>
      </div>
      <p className="portal-footer-copyright">© 2026 Learning Guide. All rights reserved.</p>
    </footer>
  );
}

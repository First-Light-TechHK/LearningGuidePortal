import Link from "next/link";
import Image from "next/image";
import { categoryHasPublishedCourse } from "@/lib/offer";
import { getPortalContent, listCatalogueEntries, listPublishedCourses } from "@/services/productStore";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

export async function PortalFooter({ locale }: { locale: Locale }) {
  const [content, courses, catalogue] = await Promise.all([getPortalContent(), listPublishedCourses(), listCatalogueEntries()]);
  const categories = content.categories.filter((category) => categoryHasPublishedCourse(courses, category.id, catalogue));
  const copy = getMessages(locale).portal;
  return (
    <footer className="portal-footer">
      <div className="portal-footer-grid">
        <div><h2>{getMessages(locale).brand}</h2><p>{copy.footerAbout}</p></div>
        <div><h2>{copy.navigation.courses}</h2>{categories.map((category) => <Link prefetch={false} key={category.id} href={`/${locale}/portal/courses?category=${encodeURIComponent(category.id)}`}>{category.labels[locale]}</Link>)}</div>
        <div><h2>{copy.footerSupport}</h2><Link prefetch={false} href={`/${locale}/help`}>{copy.footerHelp}</Link><Link prefetch={false} href={`/${locale}/contact`}>{copy.footerContact}</Link><Link prefetch={false} href={`/${locale}/cookie-policy`}>{copy.footerCookies}</Link></div>
        <div><h2>{copy.footerLegal}</h2><Link prefetch={false} href={`/${locale}/privacy-policy`}>{copy.footerPrivacy}</Link><Link prefetch={false} href={`/${locale}/terms-of-service`}>{copy.footerTerms}</Link><p className="portal-footer-copyright">{copy.footerCopyright}</p></div>
      </div>
      <div className="portal-footer-bottom"><p className="portal-footer-social"><span><Image src="/portal/help/asset-13.svg" width={40} height={40} alt="Instagram" /></span><span><Image src="/portal/help/asset-14.svg" width={40} height={40} alt="LinkedIn" /></span><span><Image src="/portal/help/asset-2.svg" width={40} height={40} alt="YouTube" /></span></p></div>
    </footer>
  );
}

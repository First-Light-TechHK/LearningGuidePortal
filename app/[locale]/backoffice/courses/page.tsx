import Link from "next/link";
import { redirect } from "next/navigation";
import { CourseManager } from "@/components/portal/CourseManager";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { currentProductUser } from "@/services/productAuth";
import { isOperator } from "@/services/productStore";

export default async function BackofficeCoursesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = localeFrom(rawLocale);
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=/${locale}/backoffice/courses`);
  if (!isOperator(user)) {
    return <main className="portal-page portal-page-narrow"><header className="portal-header"><Link className="portal-brand" href={`/${locale}/portal`}><span className="portal-brand-mark">LG</span><span>{getMessages(locale).brand}</span></Link></header><section className="portal-detail"><p className="portal-eyebrow">{getMessages(locale).backoffice.title}</p><h1>{getMessages(locale).backoffice.restricted}</h1><p className="portal-lead">{getMessages(locale).backoffice.operatorRequired}</p><Link className="portal-button portal-button-primary" href={`/${locale}/portal`}>{getMessages(locale).backoffice.returnToPortal}</Link></section></main>;
  }
  return <main className="portal-page portal-page-narrow"><header className="portal-header"><Link className="portal-brand" href={`/${locale}/portal`}><span className="portal-brand-mark">LG</span><span>{getMessages(locale).brand}</span></Link><nav className="portal-nav"><Link href={`/${locale}/backoffice/orders`}>{getMessages(locale).backoffice.orders.title}</Link><Link href={`/${locale}/backoffice/payment`}>{getMessages(locale).backoffice.payment.title}</Link><Link href={`/${locale}/portal`}>{getMessages(locale).portal.eyebrow}</Link></nav></header><CourseManager copy={getMessages(locale).backoffice} /></main>;
}

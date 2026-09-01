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
    return <main className="portal-page portal-page-narrow"><header className="portal-header"><Link className="portal-brand" href={`/${locale}/portal`}><span className="portal-brand-mark">LG</span><span>{getMessages(locale).brand}</span></Link></header><section className="portal-detail"><p className="portal-eyebrow">{getMessages(locale).backoffice.title}</p><h1>Access restricted</h1><p className="portal-lead">Course Manager/Operator access is required for this area.</p><Link className="portal-button portal-button-primary" href={`/${locale}/portal`}>Return to Portal</Link></section></main>;
  }
  return <main className="portal-page portal-page-narrow"><header className="portal-header"><Link className="portal-brand" href={`/${locale}/portal`}><span className="portal-brand-mark">LG</span><span>{getMessages(locale).brand}</span></Link><Link href={`/${locale}/portal`}>{getMessages(locale).portal.eyebrow}</Link></header><CourseManager copy={getMessages(locale).backoffice} /></main>;
}

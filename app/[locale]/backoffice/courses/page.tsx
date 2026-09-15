import Link from "next/link";
import { redirect } from "next/navigation";
import { CourseManager } from "@/components/portal/CourseManager";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { currentOperatorUser } from "@/services/productAuth";

export default async function BackofficeCoursesPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const user = await currentOperatorUser();
  if (!user) redirect(`/${locale}/backoffice/sign-in`);
  const messages = getMessages(locale);
  return (
    <main className="portal-page portal-page-narrow">
      <header className="portal-header">
        <span className="portal-brand"><span className="portal-brand-mark">LG</span><span>{messages.backoffice.title}</span></span>
        <nav className="portal-nav">
          <Link href={`/${locale}/backoffice/portal`}>{messages.portalEditor.heading}</Link>
          <Link href={`/${locale}/backoffice/orders`}>{messages.backoffice.orders.title}</Link>
          <Link href={`/${locale}/backoffice/payment`}>{messages.backoffice.payment.title}</Link>
        </nav>
      </header>
      <CourseManager locale={locale} copy={messages.backoffice} />
    </main>
  );
}

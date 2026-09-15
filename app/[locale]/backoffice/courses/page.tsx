import Link from "next/link";
import { redirect } from "next/navigation";
import { CourseManager } from "@/components/portal/CourseManager";
import { SignOutButton } from "@/components/portal/SignOutButton";
import { getMessages } from "@/lib/i18n/messages";
import { getCourseManagementMessages } from "@/lib/i18n/courseManagementMessages";
import { localeFrom } from "@/lib/i18n/config";
import { currentBackofficeAuthor } from "@/services/productAuth";
import { isOperator } from "@/services/productStore";
import { canAuthorCourses } from "@/services/backofficeAccess";
import styles from "@/components/portal/CourseManager.module.css";

export default async function BackofficeCoursesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = localeFrom(rawLocale), messages = getMessages(locale), copy = getCourseManagementMessages(locale);
  const user = await currentBackofficeAuthor();
  if (!user) redirect(`/${locale}/backoffice/sign-in`);
  if (!canAuthorCourses(user)) {
    return <main className="portal-page portal-page-narrow"><header className="portal-header"><Link className="portal-brand" href={`/${locale}/backoffice/courses`}><span className="portal-brand-mark">LG</span><span>{messages.brand}</span></Link></header><section className="portal-detail"><p className="portal-eyebrow">{messages.backoffice.title}</p><h1>{messages.backoffice.restricted}</h1><p className="portal-lead">{copy.errors.restricted}</p><Link className="portal-button portal-button-primary" href={`/${locale}/backoffice/courses`}>{messages.backoffice.returnToPortal}</Link></section></main>;
  }
  return <main className="portal-page portal-page-narrow">
    <header className={`portal-header ${styles.header}`}>
      <Link className="portal-brand" href={`/${locale}/backoffice/courses`}><span className="portal-brand-mark">LG</span><span>{messages.brand}</span></Link>
      <nav className="portal-nav"><Link href="#course-overview">{copy.dashboard}</Link><Link href="#author-profile">{copy.profile}</Link>{isOperator(user) && <>
        <Link href={`/${locale}/backoffice/portal`}>{messages.portalEditor.heading}</Link>
        <Link href={`/${locale}/backoffice/orders`}>{messages.backoffice.orders.title}</Link>
        <Link href={`/${locale}/backoffice/payment`}>{messages.backoffice.payment.title}</Link>
        <Link href="/knowledge/philosophy/epicureanism/chat-testing">{copy.aiSettings}</Link>
      </>}<SignOutButton locale={locale} label={messages.learning.signOut} backoffice/></nav>
    </header>
    <CourseManager locale={locale} operator={isOperator(user)} copy={messages.backoffice}/>
    <details id="author-profile" className={styles.profile}>
      <summary>{copy.profile}</summary>
      <dl><div><dt>{copy.name}</dt><dd>{user.nickname}</dd></div><div><dt>{copy.email}</dt><dd>{user.email || copy.none}</dd></div><div><dt>{copy.role}</dt><dd>{isOperator(user) ? copy.operator : copy.teacher}</dd></div></dl>
    </details>
  </main>;
}

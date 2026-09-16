import { AdminSignInForm } from "@/components/portal/AdminSignInForm";
import styles from "@/components/portal/BackofficeShell.module.css";
import { getMessages } from "@/lib/i18n/messages";
import { getCourseManagementMessages } from "@/lib/i18n/courseManagementMessages";
import { localeFrom } from "@/lib/i18n/config";
import { currentBackofficeAuthor } from "@/services/productAuth";
import { redirect } from "next/navigation";

export default async function BackofficeSignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  if (await currentBackofficeAuthor()) redirect(`/${locale}/backoffice/courses`);
  const copy = getMessages(locale);
  return (
    <main className={styles.signIn}>
      <div className={styles.signInCard}>
        <div className={styles.signInBrand}>
          <span className={styles.logo} aria-hidden="true">LG</span>
          <strong className={styles.brandName}>{copy.backoffice.shortTitle}</strong>
        </div>
        <h1>{copy.backoffice.title}</h1>
        <p>{getCourseManagementMessages(locale).signInHint}</p>
        <AdminSignInForm locale={locale} />
      </div>
    </main>
  );
}

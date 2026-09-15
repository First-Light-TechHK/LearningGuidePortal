import { redirect } from "next/navigation";
import { AdminSignInForm } from "@/components/portal/AdminSignInForm";
import { getMessages } from "@/lib/i18n/messages";
import { getCourseManagementMessages } from "@/lib/i18n/courseManagementMessages";
import { localeFrom } from "@/lib/i18n/config";
import { currentBackofficeAuthor } from "@/services/productAuth";

export default async function BackofficeSignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  if (await currentBackofficeAuthor()) redirect(`/${locale}/backoffice/courses`);
  const copy = getMessages(locale);
  return (
    <main className="portal-page portal-auth-page">
      <div className="portal-auth-stage">
        <div className="portal-auth-card">
          <div className="portal-auth-heading">
            <span className="portal-brand-lockup"><span className="portal-brand-mark" aria-hidden="true">LG</span><strong>{copy.brand}</strong></span>
            <h1>{copy.backoffice.title}</h1>
            <p>{getCourseManagementMessages(locale).signInHint}</p>
          </div>
          <AdminSignInForm locale={locale} />
        </div>
      </div>
    </main>
  );
}

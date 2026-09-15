import { redirect } from "next/navigation";
import { AdminSignInForm } from "@/components/portal/AdminSignInForm";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { currentOperatorUser } from "@/services/productAuth";

export default async function BackofficeSignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  if (await currentOperatorUser()) redirect(`/${locale}/backoffice/courses`);
  const copy = getMessages(locale);
  return (
    <main className="portal-page portal-auth-page">
      <div className="portal-auth-stage">
        <div className="portal-auth-card">
          <div className="portal-auth-heading">
            <span className="portal-brand-lockup"><span className="portal-brand-mark" aria-hidden="true">LG</span><strong>{copy.brand}</strong></span>
            <h1>{copy.backoffice.title}</h1>
            <p>{copy.backoffice.signInHint}</p>
          </div>
          <AdminSignInForm locale={locale} />
        </div>
      </div>
    </main>
  );
}

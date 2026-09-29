import { PasswordResetRequestForm } from "@/components/portal/PasswordResetRequestForm";
import { localeFrom } from "@/lib/i18n/config";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { safeReturnTo } from "@/services/runtimeConfig";

export default async function ForgotPasswordPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ email?: string; returnTo?: string }> }) {
  const locale = localeFrom((await params).locale);
  const query = await searchParams;
  const returnTo = safeReturnTo(query.returnTo, `/${locale}/account/my-learning`);
  return <main className="portal-page portal-auth-page"><PortalHeader locale={locale} /><div className="portal-auth-stage"><div className="portal-auth-card"><PasswordResetRequestForm locale={locale} returnTo={returnTo} initialEmail={query.email} /></div></div></main>;
}

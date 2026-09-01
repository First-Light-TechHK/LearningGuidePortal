import Link from "next/link";
import { PasswordResetRequestForm } from "@/components/portal/PasswordResetRequestForm";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { PortalHeader } from "@/components/portal/PortalHeader";

export default async function ForgotPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const messages = getMessages(locale);
  return <main className="portal-page portal-auth-page"><PortalHeader locale={locale} /><div className="portal-auth-stage"><div className="portal-auth-card"><div className="portal-auth-heading"><span className="portal-brand-mark" aria-hidden="true">LG</span></div><PasswordResetRequestForm copy={messages.auth} /><Link className="portal-auth-back" href={`/${locale}/portal/sign-in`}>{messages.auth.haveAccount}</Link></div></div></main>;
}

import Link from "next/link";
import { PasswordResetConfirmForm } from "@/components/portal/PasswordResetConfirmForm";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { PortalHeader } from "@/components/portal/PortalHeader";

export default async function ResetPasswordPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string }> }) {
  const locale = localeFrom((await params).locale);
  const token = (await searchParams).token || "";
  const messages = getMessages(locale);
  return <main className="portal-page portal-auth-page"><PortalHeader locale={locale} /><div className="portal-auth-stage"><div className="portal-auth-card"><div className="portal-auth-heading"><span className="portal-brand-mark" aria-hidden="true">LG</span></div>{token ? <PasswordResetConfirmForm token={token} copy={messages.auth} signInPath={`/${locale}/portal/sign-in`} /> : <section className="portal-form"><h1>{messages.auth.resetInvalid}</h1><p className="portal-form-error">{messages.auth.resetInvalidDescription}</p></section>}<Link className="portal-auth-back" href={`/${locale}/portal`}>{messages.auth.backToPortal}</Link></div></div></main>;
}

import { safeReturnTo } from "@/services/runtimeConfig";
import Link from "next/link";
import { PasswordResetConfirmForm } from "@/components/portal/PasswordResetConfirmForm";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { PortalHeader } from "@/components/portal/PortalHeader";

export default async function ResetPasswordPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string; returnTo?: string }> }) {
  const locale = localeFrom((await params).locale);
  const query = await searchParams;
  const token = query.token || "";
  const returnTo = safeReturnTo(query.returnTo, `/${locale}/account/my-learning`);
  const requestPath = `/${locale}/portal/forgot-password?returnTo=${encodeURIComponent(returnTo)}`;
  const messages = getMessages(locale);
  return <main className="portal-page portal-auth-page"><PortalHeader locale={locale} /><div className="portal-auth-stage"><div className="portal-auth-card"><div className="portal-auth-heading"><span className="portal-brand-mark" aria-hidden="true">LG</span></div>{token ? <PasswordResetConfirmForm token={token} locale={locale} requestPath={requestPath} signInPath={`/${locale}/portal/sign-in?step=password&returnTo=${encodeURIComponent(returnTo)}`} /> : <section className="portal-form"><h1>{messages.auth.resetInvalid}</h1><p className="portal-form-error">{messages.auth.resetInvalidDescription}</p><Link href={requestPath}>{messages.auth.resetAgain}</Link></section>}<Link className="portal-auth-back" href={`/${locale}/portal`}>{messages.auth.backToPortal}</Link></div></div></main>;
}

import { AuthForm } from "@/components/portal/AuthForm";
import { AuthEntryForm } from "@/components/portal/AuthEntryForm";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { googleEnabled, wechatEnabled } from "@/services/oauthService";
import { PortalHeader } from "@/components/portal/PortalHeader";
import Link from "next/link";

export default async function SignInPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ returnTo?: string; oauthError?: string; step?: string; email?: string }> }) {
  const { locale: rawLocale } = await params;
  const { returnTo, oauthError, step, email } = await searchParams;
  const locale = localeFrom(rawLocale);
  const messages = getMessages(locale);
  const providerError = oauthError === "account-conflict" ? messages.auth.oauthAccountConflict : oauthError === "disabled" ? messages.auth.oauthAccountDisabled : oauthError === "email" ? messages.auth.oauthEmailUnverified : oauthError ? messages.auth.oauthError : undefined;
  const safeReturnTo = returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : `/${locale}/account/my-learning`;
  const showPassword = step === "password" || Boolean(providerError);
  return <main className="portal-page portal-auth-page"><PortalHeader locale={locale} /><div className="portal-auth-stage"><div className="portal-auth-card"><div className="portal-auth-heading"><span className="portal-brand-lockup"><span className="portal-brand-mark" aria-hidden="true">LG</span><strong>{messages.brand}</strong></span><h1>{messages.auth.signInTitle}</h1><p><Link href={`/${locale}/portal/sign-up`}>{messages.auth.noAccount}</Link></p></div>{showPassword ? <AuthForm locale={locale} mode="sign-in" showTitle={false} initialEmail={email} copy={messages.auth} providerError={providerError} googleEnabled={googleEnabled()} wechatEnabled={wechatEnabled()} returnTo={safeReturnTo} /> : <AuthEntryForm locale={locale} copy={messages.auth} googleEnabled={googleEnabled()} wechatEnabled={wechatEnabled()} returnTo={safeReturnTo} />}</div></div></main>;
}

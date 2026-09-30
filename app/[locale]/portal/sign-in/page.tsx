import { AuthForm } from "@/components/portal/AuthForm";
import { AuthBrand } from "@/components/portal/AuthBrand";
import { AuthEntryForm } from "@/components/portal/AuthEntryForm";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { googleEnabled, wechatEnabled } from "@/services/oauthService";
import { safeReturnTo as normaliseReturnTo } from "@/services/runtimeConfig";
import { PortalHeader } from "@/components/portal/PortalHeader";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentEmailBindingUser } from "@/services/productAuth";
import Image from "next/image";

export default async function SignInPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ returnTo?: string; oauthError?: string; step?: string; email?: string }> }) {
  const { locale: rawLocale } = await params;
  const { returnTo, oauthError, step, email } = await searchParams;
  const locale = localeFrom(rawLocale);
  const messages = getMessages(locale);
  const providerError = oauthError === "wechat-conflict" ? messages.auth.oauthIdentityConflict : oauthError === "cancelled" ? messages.auth.oauthCancelled : oauthError === "state" ? messages.auth.oauthStateExpired : oauthError === "account-conflict" ? messages.auth.oauthAccountConflict : oauthError === "disabled" ? messages.auth.oauthAccountDisabled : oauthError === "email" ? messages.auth.oauthEmailUnverified : oauthError ? messages.auth.oauthError : undefined;
  const safeReturnTo = normaliseReturnTo(returnTo, `/${locale}/account/my-learning`);
  const bindingUser = await currentEmailBindingUser();
  if (bindingUser && (!bindingUser.email || !bindingUser.emailVerifiedAt)) redirect(`/${locale}/portal/bind-email?returnTo=${encodeURIComponent(safeReturnTo)}`);
  const showPassword = step === "password" || Boolean(providerError);
  return <main className={`portal-page portal-auth-page ${showPassword ? "portal-auth-password-page" : "portal-auth-entry-page"}`}><PortalHeader locale={locale} active={showPassword ? undefined : "study-groups"} /><div className="portal-auth-stage"><div className="portal-auth-card">{showPassword ? <><div className="portal-auth-heading"><AuthBrand name={messages.brand} /><h1>{messages.auth.signInTitle}</h1><p><Link href={`/${locale}/portal/sign-up?returnTo=${encodeURIComponent(safeReturnTo)}`}>{messages.auth.noAccount}</Link></p></div><AuthForm locale={locale} mode="sign-in" showTitle={false} initialEmail={email} copy={messages.auth} providerError={providerError} googleEnabled={googleEnabled()} wechatEnabled={wechatEnabled()} returnTo={safeReturnTo} /></> : <><div className="auth-entry-brand"><Image src="/portal/figma-signin-cap.svg" width={22} height={22} alt="" /><strong>{messages.brand}</strong></div><div className="auth-entry-title"><h1>{messages.auth.emailEntryTitle}</h1><p>{messages.auth.emailEntryDescription}</p></div><AuthEntryForm locale={locale} copy={messages.auth} googleEnabled={googleEnabled()} wechatEnabled={wechatEnabled()} returnTo={safeReturnTo} /><p className="auth-entry-terms">{messages.auth.termsAgreementPrefix}<Link href={`/${locale}/terms-of-service`}>{messages.auth.termsOfService}</Link>{messages.auth.termsAgreementAnd}<Link href={`/${locale}/privacy-policy`}>{messages.auth.privacyPolicy}</Link>{messages.auth.termsAgreementSuffix}</p></>}</div></div></main>;
}

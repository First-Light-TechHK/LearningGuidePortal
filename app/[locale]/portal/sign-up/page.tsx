import { AuthForm } from "@/components/portal/AuthForm";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { googleEnabled, wechatEnabled } from "@/services/oauthService";
import { safeReturnTo as normaliseReturnTo } from "@/services/runtimeConfig";
import { PortalHeader } from "@/components/portal/PortalHeader";

export default async function SignUpPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ returnTo?: string; oauthError?: string; email?: string }> }) {
  const { locale: rawLocale } = await params;
  const { returnTo, oauthError, email } = await searchParams;
  const locale = localeFrom(rawLocale);
  const messages = getMessages(locale);
  const providerError = oauthError === "wechat-conflict" ? messages.auth.oauthIdentityConflict : oauthError === "cancelled" ? messages.auth.oauthCancelled : oauthError === "state" ? messages.auth.oauthStateExpired : oauthError === "account-conflict" ? messages.auth.oauthAccountConflict : oauthError === "disabled" ? messages.auth.oauthAccountDisabled : oauthError === "email" ? messages.auth.oauthEmailUnverified : oauthError ? messages.auth.oauthError : undefined;
  const safeReturnTo = normaliseReturnTo(returnTo, `/${locale}/account/my-learning`);
  return <main className="portal-page portal-auth-page portal-auth-signup-page"><PortalHeader locale={locale} /><div className="portal-auth-stage"><div className="portal-auth-card"><AuthForm locale={locale} mode="sign-up" showTitle={false} signupDesign initialEmail={email} copy={messages.auth} providerError={providerError} googleEnabled={googleEnabled()} wechatEnabled={wechatEnabled()} returnTo={safeReturnTo} /></div></div></main>;
}

import { AuthForm } from "@/components/portal/AuthForm";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { googleConfigured, wechatConfigured } from "@/services/oauthService";

export default async function SignUpPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ returnTo?: string; oauthError?: string }> }) {
  const { locale: rawLocale } = await params;
  const { returnTo, oauthError } = await searchParams;
  const locale = localeFrom(rawLocale);
  const messages = getMessages(locale);
  const providerError = oauthError ? messages.auth.oauthError : undefined;
  return <main className="portal-page portal-auth-page"><AuthForm locale={locale} mode="sign-up" copy={messages.auth} providerError={providerError} googleEnabled={googleConfigured()} wechatEnabled={wechatConfigured()} returnTo={returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : `/${locale}/account/my-learning`} /></main>;
}

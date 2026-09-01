import { AuthForm } from "@/components/portal/AuthForm";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";

export default async function SignUpPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  const { locale: rawLocale } = await params;
  const { returnTo } = await searchParams;
  const locale = localeFrom(rawLocale);
  return <main className="portal-page portal-auth-page"><AuthForm locale={locale} mode="sign-up" copy={getMessages(locale).auth} returnTo={returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : `/${locale}/account/my-learning`} /></main>;
}

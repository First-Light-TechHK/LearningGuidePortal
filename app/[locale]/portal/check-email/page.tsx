import Link from "next/link";
import { CheckEmail } from "@/components/portal/CheckEmail";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { checkEmailPageModel } from "@/services/checkEmailPage";

export default async function CheckEmailPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ email?: string; resend?: string }> }) {
  const locale = localeFrom((await params).locale);
  const messages = getMessages(locale);
  const query = await searchParams;
  const email = query.email || "";
  const model = await checkEmailPageModel(email, { sent: messages.auth.checkEmailDescription, idle: messages.auth.checkEmailIdle });
  return <main className="portal-page portal-auth-page"><PortalHeader locale={locale} /><div className="portal-auth-stage"><div className="portal-auth-card"><CheckEmail locale={locale} copy={{ ...messages.auth, checkEmailDescription: model.description }} initialEmail={email} /><Link className="portal-auth-back" href={`/${locale}/portal/sign-in?email=${encodeURIComponent(email)}`}>{messages.auth.haveAccount}</Link></div></div></main>;
}

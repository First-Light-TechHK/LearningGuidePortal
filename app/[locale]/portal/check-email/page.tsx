import Link from "next/link";
import { CheckEmail } from "@/components/portal/CheckEmail";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { localeFrom } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

export default async function CheckEmailPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const messages = getMessages(locale);
  return <main className="portal-page portal-auth-page"><PortalHeader locale={locale} /><div className="portal-auth-stage"><div className="portal-auth-card"><CheckEmail locale={locale} copy={messages.auth} /><Link className="portal-auth-back" href={`/${locale}/portal/sign-in`}>{messages.auth.haveAccount}</Link></div></div></main>;
}

import Link from "next/link";
import { EmailVerification } from "@/components/portal/EmailVerification";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";

export default async function VerifyEmailPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string }> }) {
  const locale = localeFrom((await params).locale);
  const token = (await searchParams).token || "";
  const copy = getMessages(locale).auth;
  return <main className="portal-page portal-auth-page"><PortalHeader locale={locale} /><div className="portal-auth-stage"><div className="portal-auth-card"><EmailVerification token={token} locale={locale} copy={copy} /><Link className="portal-auth-back" href={`/${locale}/portal`}>{copy.backToPortal}</Link></div></div></main>;
}

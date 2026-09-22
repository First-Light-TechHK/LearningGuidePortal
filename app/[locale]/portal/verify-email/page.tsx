import Link from "next/link";
import { EmailVerification } from "@/components/portal/EmailVerification";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { getEmailAuthState } from "@/services/productStore";

export default async function VerifyEmailPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string; email?: string }> }) {
  const locale = localeFrom((await params).locale);
  const query = await searchParams;
  const token = query.token || "";
  const email = typeof query.email === "string" ? query.email.trim().toLowerCase() : "";
  const emailState = email ? await getEmailAuthState(email) : null;
  const verifiedEmail = !token && emailState?.exists && !emailState.pending ? email : "";
  const copy = getMessages(locale).auth;
  return <main className="portal-page portal-auth-page"><PortalHeader locale={locale} /><div className="portal-auth-stage"><div className="portal-auth-card"><EmailVerification token={token} verifiedEmail={verifiedEmail} locale={locale} copy={copy} /><Link className="portal-auth-back" href={`/${locale}/portal`}>{copy.backToPortal}</Link></div></div></main>;
}

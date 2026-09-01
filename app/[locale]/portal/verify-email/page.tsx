import Link from "next/link";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { verifyEmailToken } from "@/services/productStore";

export default async function VerifyEmailPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string }> }) {
  const locale = localeFrom((await params).locale);
  const token = (await searchParams).token || "";
  const copy = getMessages(locale).auth;
  let result = copy.verifyInvalid;
  if (token) {
    try { await verifyEmailToken(token); result = copy.verifySuccess; } catch (error) { result = error instanceof Error ? error.message : copy.verifyInvalid; }
  }
  return <main className="portal-page portal-auth-page"><section className="portal-form"><h1>{copy.verifyEmail}</h1><p className={result === copy.verifySuccess ? "portal-success" : "portal-form-error"}>{result}</p><Link href={`/${locale}/portal/sign-in`}>{copy.submitSignIn}</Link></section></main>;
}

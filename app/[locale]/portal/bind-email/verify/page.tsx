import { localeFrom } from "@/lib/i18n/config";
import { safeReturnTo } from "@/services/runtimeConfig";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { EmailBindingVerification } from "@/components/portal/EmailBindingVerification";
export const metadata = { referrer: "no-referrer" as const };

export default async function VerifyBindingPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string; returnTo?: string }> }) {
  const locale = localeFrom((await params).locale);
  const query = await searchParams;
  const returnTo = safeReturnTo(query.returnTo, `/${locale}/account/my-learning`);
  return <main className="portal-page portal-auth-page"><PortalHeader locale={locale} /><div className="portal-auth-stage"><div className="portal-auth-card"><EmailBindingVerification token={query.token || ""} locale={locale} returnTo={returnTo} /></div></div></main>;
}

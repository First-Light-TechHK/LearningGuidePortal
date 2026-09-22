import { redirect } from "next/navigation";
import { currentEmailBindingUser } from "@/services/productAuth";
import { safeReturnTo } from "@/services/runtimeConfig";
import { localeFrom } from "@/lib/i18n/config";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { EmailBindingForm } from "@/components/portal/EmailBindingForm";
import { getPendingEmailBinding } from "@/services/productStore";

export default async function BindEmailPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  const locale = localeFrom((await params).locale);
  const returnTo = safeReturnTo((await searchParams).returnTo, `/${locale}/account/my-learning`);
  const user = await currentEmailBindingUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  if (user.email && user.emailVerifiedAt) redirect(returnTo);
  const pendingBinding = await getPendingEmailBinding(user.id);
  return <main className="portal-page portal-auth-page"><PortalHeader locale={locale} /><div className="portal-auth-stage"><div className="portal-auth-card"><EmailBindingForm locale={locale} returnTo={returnTo} pendingBinding={pendingBinding} /></div></div></main>;
}

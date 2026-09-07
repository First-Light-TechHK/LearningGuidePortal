import { redirect } from "next/navigation";
import { SubscriptionConfirmation } from "@/components/portal/SubscriptionConfirmation";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { currentProductUser } from "@/services/productAuth";
import { getQuoteForUser } from "@/services/productStore";

export default async function SubscriptionConfirmationPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ quoteId?: string }> }) {
  const locale = localeFrom((await params).locale);
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in`);
  const quoteId = (await searchParams).quoteId || "";
  const result = await getQuoteForUser(user.id, quoteId);
  if (!result) redirect(`/${locale}/pricing`);
  const copy = getMessages(locale);
  return <main className="portal-page"><PortalHeader locale={locale} active="pricing" signedIn displayName={user.nickname} avatarUrl={user.avatarPath ? "/api/my-learning/avatar" : undefined} /><SubscriptionConfirmation locale={locale} quote={result.quote} plan={result.plan} copy={copy.portal.subscriptionConfirmation} /><PortalFooter locale={locale} /></main>;
}

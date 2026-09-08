import { redirect } from "next/navigation";
import { SubscriptionConfirmation } from "@/components/portal/SubscriptionConfirmation";
import PricingPage from "@/app/[locale]/pricing/page";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { currentProductUser } from "@/services/productAuth";
import { getQuoteForUser } from "@/services/productStore";

export default async function SubscriptionConfirmationPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ quoteId?: string }> }) {
  const locale = localeFrom((await params).locale);
  const user = await currentProductUser();
  const quoteId = (await searchParams).quoteId || "";
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=${encodeURIComponent(`/${locale}/portal/subscription/confirmation?quoteId=${encodeURIComponent(quoteId)}`)}`);
  const result = await getQuoteForUser(user.id, quoteId);
  if (!result) redirect(`/${locale}/pricing`);
  const copy = getMessages(locale);
  return <><PricingPage params={Promise.resolve({ locale })} searchParams={Promise.resolve({})} /><SubscriptionConfirmation locale={locale} quote={result.quote} plan={result.plan} copy={copy.portal.subscriptionConfirmation} /></>;
}

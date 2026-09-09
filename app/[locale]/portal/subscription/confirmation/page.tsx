import { redirect } from "next/navigation";
import { SubscriptionConfirmation } from "@/components/portal/SubscriptionConfirmation";
import PricingPage from "@/app/[locale]/pricing/page";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { currentProductUser } from "@/services/productAuth";
import { getQuoteForUser, getPortalContent } from "@/services/productStore";

export default async function SubscriptionConfirmationPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ quoteId?: string }> }) {
  const locale = localeFrom((await params).locale);
  const user = await currentProductUser();
  const quoteId = (await searchParams).quoteId || "";
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=${encodeURIComponent(`/${locale}/portal/subscription/confirmation?quoteId=${encodeURIComponent(quoteId)}`)}`);
  const result = await getQuoteForUser(user.id, quoteId);
  if (!result) redirect(`/${locale}/pricing`);
  const copy = getMessages(locale);
  const content = await getPortalContent();
  const scope = result.plan.scope || (result.plan.courseId === "*" ? "everything" : "course");
  const category = content.categories.find((item) => item.id === (result.plan.category || result.plan.scopeId));
  const planHeading = scope === "everything" ? copy.pricingDesign.everything : scope === "category" ? copy.pricingDesign.category : result.plan.name;
  const planSubtitle = scope === "category" ? category?.labels[locale] || result.plan.category || result.plan.scopeId || undefined : undefined;
  const scopeDescription = scope === "everything" ? copy.pricingDesign.allCourses : scope === "category" ? copy.pricingDesign.categoryCourses : copy.confirmationDetails.courseAccess;
  const sourceCategory = content.categories.find(item => item.id === (result.sourcePlan?.category || result.sourcePlan?.scopeId));
  const upgradeSource = result.sourceSubscription && result.sourcePlan ? { name: `${copy.pricingDesign.category} · ${sourceCategory?.labels[locale] || result.sourcePlan.name}`, validTo: result.sourceSubscription.validTo } : undefined;
  return <><PricingPage params={Promise.resolve({ locale })} searchParams={Promise.resolve({ planId: result.plan.id })} /><SubscriptionConfirmation upgradeSource={upgradeSource} planHeading={planHeading} planSubtitle={planSubtitle} scopeDescription={scopeDescription} locale={locale} quote={result.quote} plan={result.plan} copy={copy.portal.subscriptionConfirmation} /></>;
}

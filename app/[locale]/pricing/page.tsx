import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { pricingCourseGroup } from "@/lib/courseDetailPresentation";
import { pricingPageModel } from "@/lib/offer";
import { getPortalContent, getProductCourse, listCatalogueEntries, listPlans, listPublishedCourses } from "@/services/productStore";
import { PurchasePanel } from "@/components/portal/PurchasePanel";
import { PricingPlans } from "@/components/portal/PricingPlans";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { currentProductUser } from "@/services/productAuth";
import { UpgradePanel } from "@/components/portal/UpgradePanel";

export default async function PricingPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ courseId?: string; upgradeFrom?: string; planId?: string; device?: string }> }) {
  const locale = localeFrom((await params).locale);
  const { courseId, upgradeFrom, planId, device } = await searchParams;
  const content = await getPortalContent();
  const catalogue = await listCatalogueEntries();
  const plans = await listPlans();
  const publishedCourses = await listPublishedCourses();
  const course = courseId ? await getProductCourse(courseId) : null;
  const messages = getMessages(locale);
  const copy = messages.pricingDesign;
  const user = await currentProductUser();
  const model = pricingPageModel({ plans, courses: publishedCourses, courseId: course?.status === "published" ? course.id : null, catalogue });
  const directPlans = device === "mobile" ? plans.filter((plan) => plan.device === "mobile") : model.course ? plans.filter((plan) => plan.scope === "course" && plan.device === "pc" && (plan.scopeId || plan.courseId) === course?.id) : [];
  const coursePrice = model.course ? new Intl.NumberFormat(locale, { style: "currency", currency: model.course.currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: model.course.amountMinor % 100 ? 2 : 0 }).format(model.course.amountMinor / 100) : null;
  return <main className="portal-page pricing-design-page">
    <PortalHeader locale={locale} active="pricing" signedIn={Boolean(user)} displayName={user?.nickname} avatarUrl={user?.avatarPath ? "/api/my-learning/avatar" : undefined} />
    <section className="pricing-design-hero"><h1>{copy.heading}</h1><p>{messages.portal.pricingDescription}</p></section>
    <section className="pricing-design-main">
      {upgradeFrom && user ? <UpgradePanel locale={locale} subscriptionId={upgradeFrom} /> : null}
      <PricingPlans locale={locale} plans={plans} courses={publishedCourses} categories={content.categories} catalogue={catalogue} courseTitles={publishedCourses.map((course) => ({ category: pricingCourseGroup(course, content.categories, catalogue), title: course.title }))} selectedPlanId={planId} copy={copy} />
      {directPlans.length ? <section className="pricing-direct" data-offer-scope={device === "mobile" ? undefined : model.course?.scope} data-offer-plan-id={device === "mobile" ? undefined : model.course?.planId} data-offer-amount={device === "mobile" ? undefined : model.course?.amountMinor}>{device !== "mobile" && model.course ? <p className="pricing-card-price"><strong>{coursePrice}</strong></p> : null}<h2>{course?.title || messages.portal.pricingTitle}</h2><PurchasePanel locale={locale} courseId={course?.id || "*"} plans={directPlans} allowTrial={device !== "mobile"} copy={{ startTrial: messages.learning.startTrial, buy: messages.learning.buy, choosePlan: messages.learning.choosePlan }} /></section> : null}
    </section>
    <section className="pricing-design-information"><div><h2>{copy.information}</h2><p>{copy.renewal}</p><div className="pricing-information-grid">{copy.rules.map((rule) => <div key={rule.title}><h3>{rule.title}</h3><p>{rule.text}</p></div>)}</div></div></section>
    <PortalFooter locale={locale} />
  </main>;
}

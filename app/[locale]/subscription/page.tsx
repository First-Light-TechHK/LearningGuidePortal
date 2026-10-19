import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { getPortalContent, getProductCourse, getSubscriptionSelection, listPlansForPurchase, listPublishedCourses } from "@/services/productStore";
import { PurchasePanel } from "@/components/portal/PurchasePanel";
import { SubscriptionSelection } from "@/components/portal/SubscriptionSelection";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { currentProductUser } from "@/services/productAuth";

export default async function SubscriptionPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ courseId?: string; upgradeFrom?: string; planId?: string; device?: string }> }) {
  const locale = localeFrom((await params).locale);
  const { courseId, planId, device } = await searchParams;
  const content = await getPortalContent();
  const user = await currentProductUser();
  const plans = await listPlansForPurchase(user?.id);
  const selection = await getSubscriptionSelection(user?.id);
  const publishedCourses = await listPublishedCourses();
  const course = courseId ? await getProductCourse(courseId) : null;
  const messages = getMessages(locale);
  const copy = messages.pricingDesign;
  const directPlans = device === "mobile" ? plans.filter((plan) => plan.device === "mobile") : course?.status === "published" ? plans.filter((plan) => plan.scope === "course" && (plan.scopeId || plan.courseId) === course.id) : [];
  return <main className="portal-page pricing-design-page">
    <PortalHeader locale={locale} active="subscription" signedIn={Boolean(user)} displayName={user?.nickname} avatarUrl={user?.avatarPath ? "/api/my-learning/avatar" : undefined} />
    <section className="pricing-design-main">
      <SubscriptionSelection key={`${course?.id || ""}:${planId || ""}`} selection={selection} locale={locale} plans={plans} categories={content.categories} courseTitles={publishedCourses.map(({ categoryId, category, title }) => ({ category: content.categories.find((item) => item.id === categoryId || item.id === category || Object.values(item.labels).includes(category || ""))?.id || category, title }))} selectedPlanId={planId} selectedCategoryId={course?.status === "published" ? content.categories.find(item => item.id === course.categoryId || item.id === course.category || Object.values(item.labels).includes(course.category || ""))?.id : undefined} copy={copy} />
      {directPlans.length && selection.kind !== "everything" && selection.kind !== "all_categories" ? <section className="pricing-direct"><h2>{course?.title || messages.portal.pricingTitle}</h2><PurchasePanel locale={locale} courseId={course?.id || "*"} plans={directPlans} allowTrial={device !== "mobile"} copy={{ startTrial: messages.learning.startTrial, buy: messages.learning.buy, choosePlan: messages.learning.choosePlan }} /></section> : null}
    </section>
    <section className="pricing-design-information"><div><h2>{copy.information}</h2><div className="pricing-information-grid">{copy.rules.map((rule) => <div key={rule.title}><h3>{rule.title}</h3><p>{rule.text}</p></div>)}</div></div></section>
    <PortalFooter locale={locale} />
  </main>;
}

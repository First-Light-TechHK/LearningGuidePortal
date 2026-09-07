import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { getProductCourse, listPlans, listPublishedCourses } from "@/services/productStore";
import { PurchasePanel } from "@/components/portal/PurchasePanel";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { currentProductUser } from "@/services/productAuth";

export default async function PricingPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ courseId?: string }> }) {
  const locale = localeFrom((await params).locale);
  const requestedCourseId = (await searchParams).courseId;
  const courses = await listPublishedCourses();
  const requestedCourse = requestedCourseId ? await getProductCourse(requestedCourseId) : null;
  const orderedCourses = requestedCourse && requestedCourse.status === "published" ? [requestedCourse, ...courses.filter((course) => course.id !== requestedCourse.id)] : courses;
  const allPlans = await listPlans();
  const coursePlans = allPlans.filter((plan) => plan.scope === "course" && plan.device === "pc");
  const categoryPlans = allPlans.filter((plan) => plan.scope === "category" && plan.device === "pc");
  const everythingPcPlans = allPlans.filter((plan) => plan.scope === "everything" && plan.device === "pc");
  const everythingMobilePlans = allPlans.filter((plan) => plan.scope === "everything" && plan.device === "mobile");
  const categoryIds = [...new Set(categoryPlans.map((plan) => plan.scopeId || plan.category).filter(Boolean))] as string[];
  const messages = getMessages(locale);
  const copy = messages.portal;
  const learningCopy = messages.learning;
  const user = await currentProductUser();

  return <main className="portal-page"><PortalHeader locale={locale} active="pricing" signedIn={Boolean(user)} displayName={user?.nickname} avatarUrl={user?.avatarPath ? "/api/my-learning/avatar" : undefined} /><section className="portal-section portal-section-first"><p className="portal-eyebrow">{copy.pricingEyebrow}</p><h1>{copy.pricingTitle}</h1><p className="portal-lead">{copy.pricingDescription}</p><div className="pricing-list">
    {coursePlans.length ? orderedCourses.map((course) => { const plans = coursePlans.filter((plan) => (plan.scopeId || plan.courseId) === course.id); return <article className={`pricing-course ${course.id === requestedCourse?.id ? "selected" : ""}`} key={course.id}><p className="portal-course-category">PC Course · {course.category || "European Humanities"}</p><h2>{course.title}</h2><p>{course.description}</p><PurchasePanel locale={locale} courseId={course.id} plans={plans} copy={{ startTrial: learningCopy.startTrial, buy: learningCopy.buy, choosePlan: learningCopy.choosePlan }} /></article>; }) : null}
    {categoryIds.map((categoryId) => <article className="pricing-course" key={`category-${categoryId}`}><p className="portal-course-category">PC Category</p><h2>{categoryId}</h2><p>{locale === "en-GB" ? `Access published courses in the ${categoryId} category, including courses added during the active term.` : `访问“${categoryId}”分类下已发布的课程，包括周期内新增课程。`}</p><PurchasePanel locale={locale} courseId="*" plans={categoryPlans.filter((plan) => (plan.scopeId || plan.category) === categoryId)} copy={{ startTrial: learningCopy.startTrial, buy: learningCopy.buy, choosePlan: learningCopy.choosePlan }} /></article>)}
    {everythingPcPlans.length ? <article className="pricing-course pricing-everything"><p className="portal-course-category">PC Everything</p><h2>Everything</h2><p>{locale === "en-GB" ? "Access all published courses in the Learning Guide catalogue, including courses added during the active term." : "访问 Learning Guide 中所有已发布课程，包括周期内新增课程。"}</p><PurchasePanel locale={locale} courseId="*" plans={everythingPcPlans} allowTrial={false} copy={{ startTrial: learningCopy.startTrial, buy: learningCopy.buy, choosePlan: learningCopy.choosePlan }} /></article> : null}
    {everythingMobilePlans.length ? <article className="pricing-course"><p className="portal-course-category">Mobile Everything</p><h2>Everything · Mobile</h2><p>{locale === "en-GB" ? "Study and listen to all published courses on mobile. AI Tutor access is not included." : "在手机上学习和收听所有已发布课程，不包含 AI Tutor。"}</p><PurchasePanel locale={locale} courseId="*" plans={everythingMobilePlans} allowTrial={false} copy={{ startTrial: learningCopy.startTrial, buy: learningCopy.buy, choosePlan: learningCopy.choosePlan }} /></article> : null}
    {!coursePlans.length && !categoryIds.length && !everythingPcPlans.length && !everythingMobilePlans.length ? <p className="portal-empty">{copy.noCourses}</p> : null}
  </div></section><PortalFooter locale={locale} /></main>;
}

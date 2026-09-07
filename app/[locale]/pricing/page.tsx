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
  const entries = await Promise.all(orderedCourses.map(async (course) => ({ course, plans: await listPlans(course.id) })));
  const everythingPlans = (await listPlans()).filter((plan) => plan.scope === "everything");
  const messages = getMessages(locale);
  const copy = messages.portal;
  const learningCopy = messages.learning;
  const user = await currentProductUser();

  return <main className="portal-page"><PortalHeader locale={locale} active="pricing" signedIn={Boolean(user)} displayName={user?.nickname} avatarUrl={user?.avatarPath ? "/api/my-learning/avatar" : undefined} /><section className="portal-section portal-section-first"><p className="portal-eyebrow">{copy.pricingEyebrow}</p><h1>{copy.pricingTitle}</h1><p className="portal-lead">{copy.pricingDescription}</p><div className="pricing-list">{everythingPlans.length ? <article className="pricing-course pricing-everything"><h2>Everything</h2><p>{locale === "en-GB" ? "Access all published courses in the Learning Guide catalogue." : "访问 Learning Guide 中所有已发布课程。"}</p><PurchasePanel locale={locale} courseId="*" plans={everythingPlans} allowTrial={false} copy={{ startTrial: learningCopy.startTrial, buy: learningCopy.buy, choosePlan: learningCopy.choosePlan }} /></article> : null}{entries.length ? entries.map(({ course, plans }) => <article className={`pricing-course ${course.id === requestedCourse?.id ? "selected" : ""}`} key={course.id}><p className="portal-course-category">{course.category || "European Humanities"}</p><h2>{course.title}</h2><p>{course.description}</p><PurchasePanel locale={locale} courseId={course.id} plans={plans} copy={{ startTrial: learningCopy.startTrial, buy: learningCopy.buy, choosePlan: learningCopy.choosePlan }} /></article>) : <p className="portal-empty">{copy.noCourses}</p>}</div></section><PortalFooter locale={locale} /></main>;
}

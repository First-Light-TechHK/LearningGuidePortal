import Link from "next/link";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { getProductCourse, listPlans, listPublishedCourses } from "@/services/productStore";
import { PurchasePanel } from "@/components/portal/PurchasePanel";

export default async function PricingPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ courseId?: string }> }) {
  const locale = localeFrom((await params).locale);
  const requestedCourseId = (await searchParams).courseId;
  const courses = await listPublishedCourses();
  const requestedCourse = requestedCourseId ? await getProductCourse(requestedCourseId) : null;
  const orderedCourses = requestedCourse && requestedCourse.status === "published"
    ? [requestedCourse, ...courses.filter((course) => course.id !== requestedCourse.id)]
    : courses;
  const entries = await Promise.all(orderedCourses.map(async (course) => ({ course, plans: await listPlans(course.id) })));
  const messages = getMessages(locale);
  const copy = messages.portal;
  const learningCopy = messages.learning;

  return <main className="portal-page portal-page-narrow"><header className="portal-header"><Link className="portal-brand" href={`/${locale}/portal`}><span className="portal-brand-mark">LG</span><span>{messages.brand}</span></Link><nav className="portal-nav"><Link href={`/${locale}/portal/courses`}>{copy.viewCourses}</Link><Link href={`/${locale}/portal/faq`}>{copy.faq}</Link></nav></header><section className="portal-section portal-section-first"><p className="portal-eyebrow">{copy.pricingEyebrow}</p><h1>{copy.pricingTitle}</h1><p className="portal-lead">{copy.pricingDescription}</p><div className="pricing-list">{entries.length ? entries.map(({ course, plans }) => <article className={`pricing-course ${course.id === requestedCourse?.id ? "selected" : ""}`} key={course.id}><h2>{course.title}</h2><p>{course.description}</p><PurchasePanel locale={locale} courseId={course.id} plans={plans} copy={{ startTrial: learningCopy.startTrial, buy: learningCopy.buy, choosePlan: learningCopy.choosePlan }} /></article>) : <p className="portal-empty">{copy.noCourses}</p>}</div></section></main>;
}

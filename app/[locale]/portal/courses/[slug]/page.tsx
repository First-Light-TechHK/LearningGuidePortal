import Link from "next/link";
import { notFound } from "next/navigation";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { getProductCourse, listPlans, publicFirstLesson } from "@/services/productStore";
import { PurchasePanel } from "@/components/portal/PurchasePanel";

export default async function CourseDetailPage({
  params
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: rawLocale, slug } = await params;
  const locale = localeFrom(rawLocale);
  const course = await getProductCourse(slug);
  if (!course || course.status !== "published") notFound();
  const copy = getMessages(locale).portal;
  const learningCopy = getMessages(locale).learning;
  const plans = await listPlans(course.id);
  const firstLesson = publicFirstLesson(course);

  return (
    <main className="portal-page portal-page-narrow">
      <header className="portal-header">
        <Link className="portal-brand" href={`/${locale}/portal`}>
          <span className="portal-brand-mark">LG</span>
          <span>{getMessages(locale).brand}</span>
        </Link>
        <Link href={`/${locale}/portal/courses`}>{copy.viewCourses}</Link>
      </header>
      <section className="portal-detail">
        <p className="portal-eyebrow">{copy.courseDetail}</p>
        <h1>{course.title}</h1>
        <p className="portal-lead">{course.description}</p>
        <div className="portal-detail-placeholder">
          <strong>{copy.publicFirstLesson}</strong>
          <span>{firstLesson?.title || copy.productionShellDescription}</span>
          {firstLesson ? <Link className="portal-button portal-button-secondary" href={`/${locale}/portal/courses/${course.id}/public-lesson`}>{copy.openCourse}</Link> : null}
        </div>
        <PurchasePanel locale={locale} courseId={course.id} plans={plans} copy={{ startTrial: learningCopy.startTrial, buy: learningCopy.buy, choosePlan: learningCopy.choosePlan }} />
      </section>
    </main>
  );
}

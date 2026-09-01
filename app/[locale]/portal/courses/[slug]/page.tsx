import Link from "next/link";
import { notFound } from "next/navigation";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { getProductCourse, listPlans, publicFirstLesson } from "@/services/productStore";
import { PurchasePanel } from "@/components/portal/PurchasePanel";
import { CourseThumbnail } from "@/components/portal/CourseThumbnail";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";

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
  const lessons = course.sections.flatMap((section) => section.lessons);

  return (
    <main className="portal-page portal-course-detail-page">
      <PortalHeader locale={locale} active="courses" />
      <section className="course-detail-hero"><div className="course-detail-hero-image"><CourseThumbnail slug={course.slug} title={course.title} /></div><div className="course-detail-hero-copy"><p className="portal-course-tag">Course</p><h1>{course.title}</h1><p>{course.description}</p><div className="course-detail-stats"><span>{lessons.length} {copy.lessons.toLowerCase()}</span><span>{course.sections.length} {locale === "en-GB" ? "sections" : "个章节"}</span><span>{locale === "en-GB" ? "Self-paced" : "自主学习"}</span></div></div></section>
      <section className="portal-course-detail-body"><div><div className="portal-detail-intro"><p className="portal-eyebrow">{copy.courseDetail}</p><h2>{copy.whatYouWillLearn}</h2><p>{course.description}</p></div><div className="course-lesson-index"><h2>{copy.lessons || "Lessons"}</h2>{lessons.map((lesson, index) => <div className="course-lesson-row" key={lesson.id}><div><strong>{index + 1}. {lesson.title}</strong><span>{lesson.durationMinutes} {learningCopy.minutes}</span></div><span className={lesson.isPublic ? "lesson-access-open" : "lesson-access-locked"}>{lesson.isPublic ? copy.publicFirstLesson : copy.lockedLesson}</span></div>)}</div></div><aside className="course-detail-aside"><div className="portal-detail-placeholder"><strong>{copy.publicFirstLesson}</strong><span>{firstLesson?.title || copy.productionShellDescription}</span>{firstLesson ? <Link className="portal-button portal-button-secondary" href={`/${locale}/portal/courses/${course.id}/public-lesson`}>{copy.openCourse}</Link> : null}</div><PurchasePanel locale={locale} courseId={course.id} plans={plans} copy={{ startTrial: learningCopy.startTrial, buy: learningCopy.buy, choosePlan: learningCopy.choosePlan }} /></aside></section>
      <PortalFooter locale={locale} />
    </main>
  );
}

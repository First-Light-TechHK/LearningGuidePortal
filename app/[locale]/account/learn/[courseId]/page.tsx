import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { currentProductUser } from "@/services/productAuth";
import { checkEntitlement, getLearningOverview, getProductCourse } from "@/services/productStore";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { LearningRoom } from "@/components/portal/LearningRoom";

export default async function LearningPage({ params, searchParams }: { params: Promise<{ locale: string; courseId: string }>; searchParams: Promise<{ lessonId?: string }> }) {
  const { locale: rawLocale, courseId } = await params;
  const locale = localeFrom(rawLocale);
  const user = await currentProductUser();
  if (!user) redirect(`/${locale}/portal/sign-in?returnTo=/${locale}/account/learn/${courseId}`);
  const course = await getProductCourse(courseId);
  if (!course || course.status !== "published") notFound();
  const access = await checkEntitlement(user.id, course.id);
  if (!access.allowed) redirect(`/${locale}/portal/courses/${course.id}`);
  const lessons = course.sections.flatMap((section) => section.lessons.map((item) => ({ ...item, sectionTitle: section.title })));
  const { lessonId } = await searchParams;
  const lesson = lessons.find((item) => item.id === lessonId) || lessons[0];
  if (!lesson) notFound();
  const overview = await getLearningOverview(user.id);
  const study = overview.courses.find((item) => item.courseId === course.id);
  return <main className="portal-page portal-page-wide"><header className="portal-header"><Link className="portal-brand" href={`/${locale}/portal`}><span className="portal-brand-mark">LG</span><span>{getMessages(locale).brand}</span></Link><Link href={`/${locale}/account/my-learning`}>{getMessages(locale).learning.title}</Link></header><div className="learning-layout"><aside className="lesson-nav" aria-label="Course lessons"><p className="portal-eyebrow">{course.title}</p>{course.sections.map((section) => <div className="lesson-nav-section" key={section.id}><strong>{section.title}</strong>{section.lessons.map((item) => <Link className={item.id === lesson.id ? "active" : ""} href={`/${locale}/account/learn/${course.id}?lessonId=${encodeURIComponent(item.id)}`} key={item.id}>{item.title}<small>{item.durationMinutes} {getMessages(locale).learning.minutes}</small></Link>)}</div>)}</aside><LearningRoom locale={locale} courseId={course.id} lesson={lesson} initialCompleted={study?.completedLessonIds.includes(lesson.id) || false} copy={getMessages(locale).learning} /></div></main>;
}

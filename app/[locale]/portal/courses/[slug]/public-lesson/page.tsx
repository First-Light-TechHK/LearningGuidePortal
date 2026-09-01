import Link from "next/link";
import { notFound } from "next/navigation";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { getProductCourse, publicFirstLesson } from "@/services/productStore";

export default async function PublicLessonPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale: rawLocale, slug } = await params;
  const locale = localeFrom(rawLocale);
  const course = await getProductCourse(slug);
  const lesson = course ? publicFirstLesson(course) : null;
  if (!course || course.status !== "published" || !lesson) notFound();
  const copy = getMessages(locale).portal;
  return <main className="portal-page portal-page-narrow"><header className="portal-header"><Link className="portal-brand" href={`/${locale}/portal`}><span className="portal-brand-mark">LG</span><span>{getMessages(locale).brand}</span></Link><Link href={`/${locale}/portal/courses/${course.id}`}>{copy.courseDetail}</Link></header><article className="public-lesson"><p className="portal-eyebrow">{copy.publicFirstLesson}</p><h1>{lesson.title}</h1><p className="lesson-duration">{lesson.durationMinutes} {getMessages(locale).learning.minutes}</p><div className="lesson-body">{lesson.body.split("\n\n").map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div><Link className="portal-button portal-button-primary" href={`/${locale}/portal/courses/${course.id}`}>{copy.openCourse}</Link></article></main>;
}

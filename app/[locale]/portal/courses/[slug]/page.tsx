import Link from "next/link";
import { notFound } from "next/navigation";
import { getCourse } from "@/services/courseStore";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";

export default async function CourseDetailPage({
  params
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: rawLocale, slug } = await params;
  const locale = localeFrom(rawLocale);
  const course = await getCourse(slug);
  if (!course) notFound();
  const copy = getMessages(locale).portal;

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
        <p className="portal-lead">{copy.publicFirstLesson}</p>
        <div className="portal-detail-placeholder">
          <strong>{copy.publicFirstLesson}</strong>
          <span>{copy.productionShellDescription}</span>
        </div>
      </section>
    </main>
  );
}

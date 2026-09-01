import Link from "next/link";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { listPublishedCourses } from "@/services/productStore";

export default async function CoursesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = localeFrom(rawLocale);
  const copy = getMessages(locale).portal;
  const courses = await listPublishedCourses();

  return (
    <main className="portal-page portal-page-narrow">
      <header className="portal-header">
        <Link className="portal-brand" href={`/${locale}/portal`}>
          <span className="portal-brand-mark">LG</span>
          <span>{getMessages(locale).brand}</span>
        </Link>
        <nav className="portal-nav"><Link href={`/${locale}/portal/faq`}>{copy.faq}</Link><Link href={`/${locale}/portal/sign-in`}>{copy.signIn}</Link></nav>
      </header>
      <section className="portal-section portal-section-first">
        <p className="portal-eyebrow">{copy.featuredCourses}</p>
        <h1>{copy.featuredCourses}</h1>
        {courses.length ? (
          <div className="portal-course-list">
            {courses.map((course) => (
              <Link className="portal-course-row" href={`/${locale}/portal/courses/${course.id}`} key={course.id}>
                <span>
                  <strong>{course.title}</strong>
                  <small>{copy.publicFirstLesson}</small>
                </span>
                <span aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        ) : <p className="portal-empty">{copy.noCourses}</p>}
      </section>
    </main>
  );
}

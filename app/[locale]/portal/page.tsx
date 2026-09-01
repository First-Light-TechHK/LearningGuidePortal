import Link from "next/link";
import { listCourses } from "@/services/courseStore";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";

export default async function PortalHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = localeFrom(rawLocale);
  const copy = getMessages(locale).portal;
  const courses = await listCourses();

  return (
    <main className="portal-page">
      <header className="portal-header">
        <Link className="portal-brand" href={`/${locale}/portal`}>
          <span className="portal-brand-mark">LG</span>
          <span>{getMessages(locale).brand}</span>
        </Link>
        <nav className="portal-nav" aria-label="Primary navigation">
          <Link href={`/${locale}/portal/courses`}>{copy.viewCourses}</Link>
          <Link href={`/${locale}/portal/sign-in`}>{copy.signIn}</Link>
        </nav>
      </header>

      <section className="portal-hero">
        <p className="portal-eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p className="portal-lead">{copy.description}</p>
        <div className="portal-actions">
          <Link className="portal-button portal-button-primary" href={`/${locale}/portal/courses`}>
            {copy.viewCourses}
          </Link>
          <Link className="portal-button portal-button-secondary" href={`/${locale}/portal/sign-in`}>
            {copy.signIn}
          </Link>
        </div>
      </section>

      <section className="portal-section" aria-labelledby="course-heading">
        <div className="portal-section-heading">
          <div>
            <p className="portal-eyebrow">{copy.featuredCourses}</p>
            <h2 id="course-heading">{copy.featuredCourses}</h2>
          </div>
          <Link href={`/${locale}/portal/courses`}>{copy.viewCourses}</Link>
        </div>
        {courses.length ? (
          <div className="portal-course-grid">
            {courses.map((course) => (
              <article className="portal-course-card" key={course.id}>
                <p className="portal-card-label">{copy.courseDetail}</p>
                <h3>{course.title}</h3>
                <p>{copy.publicFirstLesson}</p>
                <Link href={`/${locale}/portal/courses/${course.id}`}>{copy.openCourse}</Link>
              </article>
            ))}
          </div>
        ) : (
          <p className="portal-empty">{copy.noCourses}</p>
        )}
      </section>

      <aside className="portal-status">
        <strong>{copy.productionShell}</strong>
        <span>{copy.productionShellDescription}</span>
      </aside>
    </main>
  );
}

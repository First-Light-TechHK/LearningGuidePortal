import Link from "next/link";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { listPublishedCourses } from "@/services/productStore";
import { currentProductUser } from "@/services/productAuth";
import { CourseThumbnail } from "@/components/portal/CourseThumbnail";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";

export default async function PortalHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = localeFrom(rawLocale);
  const copy = getMessages(locale).portal;
  const courses = await listPublishedCourses();
  const user = await currentProductUser();

  return (
    <main className="portal-page portal-home-page">
      <PortalHeader locale={locale} signedIn={Boolean(user)} />
      <section className="portal-home-hero">
        <div className="portal-home-hero-content">
          <p className="portal-eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p className="portal-lead">{copy.description}</p>
          <div className="portal-actions">
            <Link className="portal-button portal-button-primary" href={`/${locale}/portal/courses`}>{copy.viewCourses}</Link>
            <Link className="portal-button portal-button-outline-light" href={user ? `/${locale}/account/my-learning` : `/${locale}/portal/sign-in`}>{user ? copy.myLearning : copy.signIn}</Link>
          </div>
        </div>
      </section>

      <section className="portal-benefits" aria-labelledby="benefits-heading">
        <div className="portal-section-heading"><div><p className="portal-eyebrow">{copy.whatYouWillLearn}</p><h2 id="benefits-heading">{copy.whatYouWillLearn}</h2></div></div>
        <div className="portal-benefits-grid">{copy.benefits.map((benefit) => <div className="portal-benefit" key={benefit}><span className="portal-benefit-icon" aria-hidden="true">✓</span><strong>{benefit}</strong><p>{copy.description}</p></div>)}</div>
      </section>

      <section className="portal-section portal-section-courses" aria-labelledby="course-heading">
        <div className="portal-section-heading"><div><p className="portal-eyebrow">{copy.featuredCourses}</p><h2 id="course-heading">{copy.popularCourses}</h2><p className="portal-section-description">{copy.popularCoursesDescription}</p></div><Link className="portal-text-link" href={`/${locale}/portal/courses`}>{copy.viewCourses}</Link></div>
        {courses.length ? <div className="portal-course-grid">{courses.map((course) => { const lessonCount = course.sections.reduce((total, section) => total + section.lessons.length, 0); return <article className="portal-course-card" key={course.id}><div className="portal-course-image-wrap"><CourseThumbnail slug={course.slug} title={course.title} /><span className="portal-course-tag">Course</span></div><div className="portal-course-card-body"><h3>{course.title}</h3><div className="portal-course-meta"><span>{copy.publicFirstLesson}</span><span>{lessonCount} {copy.lessons.toLowerCase()}</span></div><p>{course.description}</p><Link className="portal-button portal-button-primary" href={`/${locale}/portal/courses/${course.id}`}>{copy.openCourse}</Link></div></article>; })}</div> : <p className="portal-empty">{copy.noCourses}</p>}
      </section>

      <section className="portal-quick-guide"><div><p className="portal-eyebrow">{copy.whyUs}</p><h2>{copy.whyUsTitle}</h2><div className="portal-guide-list">{copy.quicklyGuideSteps.map((step, index) => <div key={step}><span>0{index + 1}</span><strong>{step}</strong></div>)}</div></div><div className="portal-quick-guide-image" role="img" aria-label="A learner studying in a library" /></section>
      <PortalFooter locale={locale} />
    </main>
  );
}

import Link from "next/link";
import Image from "next/image";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { getPortalContent, listPublishedCourses } from "@/services/productStore";
import { currentProductUser } from "@/services/productAuth";
import { CatalogueCourseCard } from "@/components/portal/CatalogueCourseCard";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { BannerCarousel } from "@/components/portal/BannerCarousel";
import { signCourseMediaUrl } from "@/services/persistence/s3";
import styles from "@/components/portal/home.module.css";

export default async function PortalHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = localeFrom(rawLocale);
  const copy = getMessages(locale).portal;
  const home = getMessages(locale).homeDesign;
  const courses = await listPublishedCourses();
  const content = await getPortalContent();
  const user = await currentProductUser();

  return (
    <main className={`portal-page portal-home-page ${styles.page}`}>
      <PortalHeader locale={locale} signedIn={Boolean(user)} displayName={user?.nickname} avatarUrl={user?.avatarPath ? "/api/my-learning/avatar" : undefined} />
      <BannerCarousel locale={locale} home />

      <section className={styles.courses} aria-labelledby="course-heading">
        <h2 id="course-heading">{home.popular}</h2>
        {courses.length ? <div className={styles.courseGrid}>{await Promise.all(courses.map(async course => <CatalogueCourseCard variant="home" key={course.id} course={{ ...course, cover: await signCourseMediaUrl(course.cover || course.thumbnailPath || "") }} locale={locale} category={content.categories.find(item => item.id === (course.category || "European Humanities"))?.labels[locale] || course.category || ""} />))}</div> : <p className="portal-empty">{copy.noCourses}</p>}
        <Link prefetch={false} className={styles.allCourses} href={`/${locale}/portal/courses`}>{home.allCourses}</Link>
      </section>

      <section id="why-us" className={styles.why} aria-labelledby="why-heading"><p>{home.why}</p><h2 id="why-heading">{home.whyTitle}</h2><Image className={styles.underline} src="/portal/home/underline.svg" alt="" width={161.5} height={14.1308} /></section>
      <section className={styles.values} aria-label={home.why}>{home.values.map((value, index) => <article key={value.title}><span>{index + 1}.</span><h3>{value.title}</h3><p>{value.text}</p></article>)}</section>
      <section className={styles.guide}><div className={styles.guideInner}><div><h2>{home.guide}</h2><div className={styles.guideSteps}>{home.steps.map(step => <article key={step.title}><h3>{step.title}</h3><p>{step.text}</p></article>)}</div></div><Image className={styles.guideImage} src="/portal/home/quick-guide.png" width={563} height={522} alt={home.guideImage} /></div></section>
      <PortalFooter locale={locale} />
    </main>
  );
}

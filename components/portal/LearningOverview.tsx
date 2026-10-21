import Link from "next/link";
import type { LearningOverviewDisplay } from "@/contracts/learning-overview-display";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { CourseThumbnail } from "./CourseThumbnail";
import styles from "./learning-overview.module.css";

export function LearningOverview({ display, locale, name, categoryLabels = {} }: {
  display: LearningOverviewDisplay; locale: Locale; name: string; categoryLabels?: Record<string, string>;
}) {
  const messages = getMessages(locale), copy = messages.learningOverview;
  const category = (id: string) => categoryLabels[id] || id;
  return <section className={`account-dashboard ${styles.dashboard}`} aria-labelledby="overview-heading">
    <h1 id="overview-heading" className={styles.welcome}>{messages.overviewDesign.welcome.replace("{name}", name)}</h1>
    <section aria-labelledby="learning-heading" className={styles.learningSection}>
      <div className={styles.heading}><h2 id="learning-heading">{copy.learning}</h2><p>{messages.overviewDesign.courseStates}</p></div>
      {display.learning.length ? <div className={styles.grid} data-learning-courses>{display.learning.map(course => {
        const completed = course.progress === 100;
        const query = new URLSearchParams({viewMode:course.mode});
        if (course.currentLessonId) query.set("lessonId",course.currentLessonId);
        if (course.currentContentId) query.set("contentId",course.currentContentId);
        const href = `/${locale}/account/learn/${encodeURIComponent(course.courseId)}?${query}`;
        return <article className={`${styles.card} ${completed ? styles.completed : ""}`} key={course.courseId} data-course-id={course.courseId}>
          <div className={styles.cover}><CourseThumbnail slug={course.slug} title={course.title} src={course.cover}/><span className={styles.category}>{category(course.category)}</span></div>
          <div className={styles.cardBody}>
            <div className={styles.cardHeading}><h3 title={course.title}>{course.title}</h3><span className={styles.mode}>{course.mode === "video" ? messages.courseLearningMode.video : messages.courseLearningMode.text}</span></div>
            <div className={styles.progressRow}><div className={styles.progress} role="progressbar" aria-label={`${course.title}: ${messages.learning.progress}`} aria-valuenow={course.progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${course.progress}%` }}/></div><span className={styles.percentage}>{course.progress}%</span></div>
            <div className={styles.cardBottom}><span>{completed ? messages.learning.completed : course.currentLesson ? copy.currentLesson.replace("{number}", String(course.currentLesson)) : messages.learning.inProgress}</span><Link prefetch={false} href={href} aria-label={`${completed ? messages.overviewDesign.review : copy.continue}: ${course.title}`}>{completed ? messages.overviewDesign.review : copy.continue}</Link></div>
          </div>
        </article>;
      })}</div> : <EmptyCourses locale={locale} text={copy.noLearning}/>}
    </section>
    <section aria-labelledby="previewed-heading" className={styles.previewSection}>
      <h2 id="previewed-heading">{copy.previewed}</h2>
      {display.previewed.length ? <div className={styles.previewList} data-previewed-courses>{display.previewed.map((course, index) => <article className={`${styles.previewRow} ${index === display.previewed.length - 1 ? styles.lastRow : ""}`} key={course.courseId} data-course-id={course.courseId}>
        <div className={styles.previewCover}><CourseThumbnail slug={course.slug} title={course.title} src={course.cover}/></div>
        <div className={styles.previewIdentity}><span className={styles.category}>{category(course.category)}</span><h3>{course.title}</h3></div>
        <Link prefetch={false} className={styles.detail} href={`/${locale}/portal/courses/${encodeURIComponent(course.courseId)}`} aria-label={`${copy.detail}: ${course.title}`}>{copy.detail}</Link>
      </article>)}</div> : <EmptyCourses locale={locale} text={copy.noPreviewed}/>}
    </section>
  </section>;
}

function EmptyCourses({ locale, text }: { locale: Locale; text: string }) {
  return <div className={styles.empty}><p>{text}</p><Link className="portal-button portal-button-primary" href={`/${locale}/portal/courses`}>{getMessages(locale).portal.viewCourses}</Link></div>;
}

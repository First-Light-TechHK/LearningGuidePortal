import Image from "next/image";
import Link from "next/link";
import type { OverviewDesignSample } from "@/contracts/overview-design-sample";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import styles from "./overview-design.module.css";

export function OverviewDesign({ sample, locale }: { sample: OverviewDesignSample; locale: Locale }) {
  const messages=getMessages(locale), copy=messages.overviewV1;
  return <section className={`account-dashboard ${styles.dashboard}`} aria-labelledby="overview-heading">
    <h1 id="overview-heading">{messages.overviewDesign.welcome.replace("{name}",sample.name)}</h1>
    <section aria-labelledby="your-learning-heading"><header className={styles.heading}><h2 id="your-learning-heading">{copy.learning}</h2><p>{copy.description}</p></header>
      <div className={styles.list}>{sample.courses.map(course=>{
        const completed=course.progress===100;
        const href=course.action==="plans" ? `/${locale}/pricing${course.courseId?`?courseId=${encodeURIComponent(course.courseId)}`:""}`
          : course.courseId ? `/${locale}/account/learn/${encodeURIComponent(course.courseId)}?${new URLSearchParams({viewMode:course.mode,...(course.lessonId?{lessonId:course.lessonId}:{})})}` : `/${locale}/portal/courses`;
        return <article key={course.id} data-overview-course={course.id} className={`${styles.card} ${completed?styles.completed:""}`}>
          <div className={`${styles.cover} ${course.id==="sample-history"?styles.historyCover:""}`}><Image src={course.cover} alt="" width={280} height={130}/></div>
          <div className={styles.content}><span className={styles.category}>{copy.categories[course.category]}</span><h3>{course.title}</h3>
            <p className={styles.metadata}>{copy.lessons.replace("{count}",String(course.lessonCount))} · {completed?messages.learning.completed:messages.learningOverview.currentLesson.replace("{number}",String(course.currentLesson || 1))}</p>
            <div className={styles.track} role="progressbar" aria-label={`${course.title}: ${messages.learning.progress}`} aria-valuenow={course.progress} aria-valuemin={0} aria-valuemax={100}><span style={{width:`${course.progress}%`}}/></div>
            <div className={styles.progressLabels}><span>{course.mode==="video"?copy.video:copy.text}</span><strong>{course.progress}%</strong></div>
          </div>
          <Link className={styles.action} href={href} prefetch={false} aria-label={`${copy.actions[course.action]}: ${course.title}`}>{copy.actions[course.action]}</Link>
        </article>;
      })}</div>
    </section>
  </section>;
}

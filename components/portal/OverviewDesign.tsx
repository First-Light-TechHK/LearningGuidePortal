import Image from "next/image";
import Link from "next/link";
import type { OverviewDisplay } from "@/contracts/overview-display";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import styles from "./overview-design.module.css";

export function OverviewDesign({ data, locale }: { data: OverviewDisplay; locale: Locale }) {
  const messages=getMessages(locale), copy=messages.overviewV1;
  return <section className={`account-dashboard ${styles.dashboard}`} aria-labelledby="overview-heading">
    <h1 id="overview-heading">{messages.overviewDesign.welcome.replace("{name}",data.name)}</h1>
    <section aria-labelledby="your-learning-heading"><header className={styles.heading}><h2 id="your-learning-heading">{copy.learning}</h2><p>{copy.description}</p></header>
      {!data.courses.length&&<div className={styles.empty}><p>{messages.learningOverview.noLearning}</p><Link href={`/${locale}/portal/courses`}>{messages.portal.navigation.courses}</Link></div>}
      <div className={styles.list}>{data.courses.map(course=>{
        const completed=course.progress===100;
        const action=course.action==="preview"?messages.overviewDesign.continuePreview:course.action==="detail"?messages.learningOverview.detail:copy.actions[course.action];
        return <article key={course.id} data-overview-course={course.id} className={`${styles.card} ${completed?styles.completed:""}`}>
          <div className={styles.cover}><Image src={course.cover} alt="" width={280} height={130} unoptimized/></div>
          <div className={styles.content}>{course.category&&<span className={styles.category}>{course.category}</span>}<h3>{course.title}</h3>
            <p className={styles.metadata}>{copy.lessons.replace("{count}",String(course.lessonCount))} · {completed?messages.learning.completed:messages.learningOverview.currentLesson.replace("{number}",String(course.currentLesson || 1))}</p>
            {course.progress===null?<p role="status" className={styles.progressError}>{messages.overviewDesign.progressUnavailable}</p>:<div className={styles.track} role="progressbar" aria-label={`${course.title}: ${messages.learning.progress}`} aria-valuenow={course.progress} aria-valuemin={0} aria-valuemax={100}><span style={{width:`${course.progress}%`}}/></div>}
            <div className={styles.progressLabels}><span>{course.mode==="video"?copy.video:copy.text}</span>{course.progress!==null&&<strong>{course.progress}%</strong>}</div>
          </div>
          <Link className={styles.action} href={course.href} prefetch={false} aria-label={`${action}: ${course.title}`}>{action}</Link>
        </article>;
      })}</div>
    </section>
  </section>;
}

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
        const completed=course.learningState === "completed";
        const action=course.action==="preview"?messages.overviewDesign.continuePreview:course.action==="detail"?messages.learningOverview.detail:copy.actions[course.action];
        return <article key={course.id} data-overview-course={course.id} data-learning-state={course.learningState} className={styles.card}>
          <div className={styles.cover}><Image src={course.cover} alt="" width={191} height={130} unoptimized/></div>
          <div className={styles.content}><div className={styles.tags}>{course.category&&<span className={styles.category}>{course.category}</span>}{completed&&<span className={styles.completedTag} data-course-completed><Image src="/portal/overview-v1/completed.svg" alt="" width={14} height={14}/>{copy.completed}</span>}</div><h3>{course.title}</h3>
            {course.action === "resume" && <div className={styles.continuation}><p className={styles.continueLesson}><span>{copy.continueLabel}</span> {copy.continueLesson.replace("{number}",String(course.currentLesson || 1)).replace("{title}",course.lessonTitle || "")}</p>
              {course.bookmark&&<p className={styles.bookmark} data-course-bookmark><Image src={`/portal/overview-v1/${course.bookmark.mode}.svg`} alt="" width={16} height={16}/>{(course.bookmark.mode === "video" ? messages.lessonBookmark.video : messages.lessonBookmark.text).replace("{lp}",course.bookmark.lpNumber)}</p>}</div>}
            {course.action === "preview"&&<p className={styles.metadata}>{copy.lessons.replace("{count}",String(course.lessonCount))} · {messages.overviewDesign.previewing}</p>}
          </div>
          <Link className={styles.action} href={course.href} prefetch={false} aria-label={`${action}: ${course.title}`}>{action}</Link>
        </article>;
      })}</div>
    </section>
  </section>;
}

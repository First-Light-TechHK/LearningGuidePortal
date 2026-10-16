"use client";

import Link from "next/link";
import Image from "next/image";
import { useRef, useState } from "react";
import type { ApplicationTestAttempt } from "@/contracts/application-test";
import type { UnderstandingOverviewDisplay } from "@/contracts/understanding-overview";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { getApplicationTestSample } from "@/services/applicationTestSample";
import { KnowledgeTestDialog } from "./KnowledgeTestDialog";
import { ApplicationTestDialog } from "./ApplicationTestDialog";
import styles from "./understanding-overview.module.css";

export function UnderstandingOverview({ locale, courseId, courseTitle, category, backHref, data }: {
  locale:Locale; courseId:string; courseTitle:string; category:string; backHref:string; data:UnderstandingOverviewDisplay;
}) {
  const messages=getMessages(locale), copy=messages.understandingOverview, tests=messages.lessonCompleted;
  const [expanded,setExpanded]=useState(["01","02"]);
  const [modal,setModal]=useState<{kind:"knowledge"|"application";lesson:string;result:boolean}|null>(null);
  const applicationAttempts = useRef<Record<string, ApplicationTestAttempt>>({});
  const [knowledgeCompleted, setKnowledgeCompleted] = useState<string[]>([]);
  const close=()=>setModal(null);
  const courseHref=`/${locale}/portal/courses/${encodeURIComponent(courseId)}`;
  return <div className={styles.page} data-course-id={courseId}>
    <nav className={styles.breadcrumb} aria-label={messages.courseDetailDesign.breadcrumb}><Link href={`/${locale}/portal/courses`}>{messages.portal.navigation.courses}</Link><span>/</span>{category && <><Link href={`/${locale}/portal/courses?category=${encodeURIComponent(category)}`}>{category}</Link><span>/</span></>}<Link href={courseHref}>{courseTitle}</Link><span>/</span><span aria-current="page">{copy.title}</span></nav>
    <div className={styles.content}><Link className={styles.back} href={backHref}>← {copy.back}</Link>
      <article className={styles.panel}><header><h1>{copy.title}</h1><p>{copy.description}</p></header>
        <section className={styles.progressSection} aria-label={copy.progress}><h2>{copy.progress}</h2><div className={styles.progressLabel}><strong>{copy.completedCount.replace("{completed}",String(data.completed)).replace("{total}",String(data.total))}</strong><span>{data.percent}%</span></div><div className={styles.progress} role="progressbar" aria-label={copy.progress} aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.completed}><span style={{width:`${data.percent}%`}}/></div></section>
        <section className={styles.courseAssessment}><h2>{copy.courseAssessment}</h2><div><strong>{tests.fluency}</strong><button type="button" disabled>{tests.comingSoon}</button></div></section>
        <section className={styles.lessonAssessments} aria-label={copy.lessonAssessments}><h2>{copy.lessonAssessments}</h2>
          <div className={`${styles.columns} ${styles.tableHeader}`} aria-hidden="true"><span>{copy.lessonAssessment}</span><span>{copy.status}</span><span>{copy.latestResult}</span><span>{copy.action}</span></div>
          <div className={styles.lessons}>{data.lessons.map(lesson=>{
            const open=expanded.includes(lesson.number), locked=lesson.state==="locked", completed=lesson.state==="completed";
            const rows=[{kind:"knowledge" as const,title:tests.knowledge,status:completed?copy.completed:copy.inProgress,result:completed?"80%":copy.answered,action:completed?copy.viewResult:copy.continue},{kind:"application" as const,title:tests.application,status:completed?copy.evaluated:copy.available,result:completed?copy.strong:"—",action:completed?copy.viewResult:copy.start}];
            return <section className={`${styles.lesson} ${completed?styles.completedLesson:""}`} key={lesson.number}>
              {locked ? <div className={styles.locked}><span className={styles.number}>{lesson.number}</span><h3>{lesson.title}</h3><p>{copy.locked}</p></div> : <>
                <button className={styles.lessonHeader} type="button" aria-expanded={open} aria-controls={`assessment-${lesson.number}`} onClick={()=>setExpanded(current=>open?current.filter(number=>number!==lesson.number):[...current,lesson.number])}><span className={styles.number}>{lesson.number}</span><h3>{lesson.title}</h3><span className={`${styles.badge} ${completed?styles.completeBadge:""}`}>{completed?copy.completed:copy.current}</span><span aria-hidden="true" className={styles.chevron}><Image src="/portal/understanding/lesson-chevron-up.png" alt="" width={11} height={7}/></span></button>
                {open && <div id={`assessment-${lesson.number}`}>{rows.map(row=><div className={`${styles.columns} ${styles.row}`} key={row.kind}><strong>{row.title}</strong><span className={`${styles.status} ${completed && row.kind==="knowledge"?styles.green:row.kind==="application"&&!completed?styles.available:""}`}>{!(row.kind==="application"&&!completed)&&<span aria-hidden="true">● </span>}{row.status}</span><b>{row.result}</b><button type="button" onClick={()=>setModal({kind:row.kind,lesson:lesson.number,result:completed})}>{row.action}</button></div>)}</div>}
              </>}
            </section>;
          })}</div>
        </section>
      </article>
    </div>
    {modal?.kind==="knowledge" && <KnowledgeTestDialog key={`knowledge-${modal.lesson}`} locale={locale} lessonNumber={modal.lesson} lessonTitle={data.lessons.find(lesson => lesson.number === modal.lesson)?.title} onComplete={() => setKnowledgeCompleted(current => current.includes(modal.lesson) ? current : [...current, modal.lesson])} onApplicationTest={() => { setKnowledgeCompleted(current => current.includes(modal.lesson) ? current : [...current, modal.lesson]); setModal({kind:"application",lesson:modal.lesson,result:false}); }} initialView={modal.result?"result":"question"} onExit={close}/>}
    {modal?.kind==="application" && <ApplicationTestDialog key={`application-${modal.lesson}`} locale={locale} entrySource="overview" lessonNumber={modal.lesson} lessonTitle={data.lessons.find(lesson => lesson.number === modal.lesson)?.title} initialAttempt={applicationAttempts.current[modal.lesson]} onAttemptChange={attempt => { applicationAttempts.current[modal.lesson] = attempt; }} knowledgeCompleted={knowledgeCompleted.includes(modal.lesson) || data.lessons.find(lesson => lesson.number === modal.lesson)?.state === "completed"} onKnowledgeTest={() => setModal({kind:"knowledge",lesson:modal.lesson,result:false})} initialView={modal.result?"result":"answer"} initialAnswer={modal.result?getApplicationTestSample(locale).sampleAnswer:""} onBack={close} onDone={close}/>}
  </div>;
}

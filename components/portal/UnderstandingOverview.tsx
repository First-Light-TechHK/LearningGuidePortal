"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import type { UnderstandingOverviewDisplay } from "@/contracts/understanding-overview";
import type { AssessmentKind } from "@/contracts/lesson-assessment";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { PersistedAssessmentDialog } from "./PersistedAssessmentDialog";
import styles from "./understanding-overview.module.css";

export function UnderstandingOverview({ locale, courseId, courseTitle, category, backHref, data }: {
  locale:Locale; courseId:string; courseTitle:string; category:string; backHref:string; data:UnderstandingOverviewDisplay;
}) {
  const messages=getMessages(locale), copy=messages.understandingOverview, tests=messages.lessonCompleted, records=messages.assessmentRecords;
  const [view,setView]=useState(data), [error,setError]=useState("");
  const [expanded,setExpanded]=useState(data.lessons.filter(lesson=>lesson.state!=="locked").map(lesson=>lesson.id));
  const [modal,setModal]=useState<{kind:AssessmentKind;lessonId:string}|null>(null);
  useEffect(()=>setView(data),[data]);
  const refresh=async()=>{
    try {
      const response=await fetch(`/api/courses/${encodeURIComponent(courseId)}/understanding`,{cache:"no-store"});
      const body=await response.json();if(!response.ok||!body.ok)throw new Error();
      const newlyUnlocked=(body.data as UnderstandingOverviewDisplay).lessons.filter(lesson=>lesson.state!=="locked"&&view.lessons.find(previous=>previous.id===lesson.id)?.state==="locked").map(lesson=>lesson.id);
      setExpanded(current=>[...new Set([...current,...newlyUnlocked])]);setView(body.data);setError("");
    }catch{setError(records.refreshError);}
  };
  const close=()=>{setModal(null);void refresh();};
  const selected=view.lessons.find(lesson=>lesson.id===modal?.lessonId);
  const nextLesson=selected ? view.lessons[view.lessons.indexOf(selected)+1] : undefined;
  const courseHref=`/${locale}/portal/courses/${encodeURIComponent(courseId)}`;
  return <div className={styles.page} data-course-id={courseId}>
    <nav className={styles.breadcrumb} aria-label={messages.courseDetailDesign.breadcrumb}><Link href={`/${locale}/portal/courses`}>{messages.portal.navigation.courses}</Link><span>/</span>{category && <><Link href={`/${locale}/portal/courses?category=${encodeURIComponent(category)}`}>{category}</Link><span>/</span></>}<Link href={courseHref}>{courseTitle}</Link><span>/</span><span aria-current="page">{copy.title}</span></nav>
    <div className={styles.content}><Link className={styles.back} href={backHref}>{"\u2190"} {copy.back}</Link>
      <article className={styles.panel}><header><h1>{copy.title}</h1><p>{copy.description}</p></header>
        {error&&<p role="alert">{error} <button onClick={()=>void refresh()}>{records.retry}</button></p>}
        <section className={styles.progressSection} aria-label={copy.progress}><h2>{copy.progress}</h2><div className={styles.progressLabel}><strong>{copy.completedCount.replace("{completed}",String(view.completed)).replace("{total}",String(view.total))}</strong><span>{view.percent}%</span></div><div className={styles.progress} role="progressbar" aria-label={copy.progress} aria-valuemin={0} aria-valuemax={Math.max(1,view.total)} aria-valuenow={view.completed}><span style={{width:`${view.percent}%`}}/></div></section>
        <section className={styles.courseAssessment}><h2>{copy.courseAssessment}</h2><div><strong>{tests.fluency}</strong><button type="button" disabled>{tests.comingSoon}</button></div></section>
        <section className={styles.lessonAssessments} aria-label={copy.lessonAssessments}><h2>{copy.lessonAssessments}</h2>
          <div className={`${styles.columns} ${styles.tableHeader}`} aria-hidden="true"><span>{copy.lessonAssessment}</span><span>{copy.status}</span><span>{copy.latestResult}</span><span>{copy.action}</span></div>
          {!view.lessons.length&&<p role="status">{records.empty}</p>}
          <div className={styles.lessons}>{view.lessons.map(lesson=>{
            const open=expanded.includes(lesson.id), locked=lesson.state==="locked", completed=lesson.state==="completed";
            return <section className={`${styles.lesson} ${completed?styles.completedLesson:""}`} key={lesson.id} data-lesson-id={lesson.id}>
              <button className={styles.lessonHeader} type="button" aria-expanded={open} aria-controls={`assessment-${lesson.number}`} onClick={()=>setExpanded(current=>open?current.filter(id=>id!==lesson.id):[...current,lesson.id])}><span className={styles.number}>{lesson.number}</span><h3>{lesson.title}</h3><span className={`${styles.badge} ${completed?styles.completeBadge:locked?styles.lockedBadge:""}`}>{completed?copy.completed:locked?(view.lessons.indexOf(lesson)>0?copy.unlocksAfter.replace("{number}",String(view.lessons.indexOf(lesson))):copy.locked):copy.current}</span>{!locked&&<span aria-hidden="true" className={styles.chevron}><Image src="/portal/understanding/lesson-chevron-up.png" alt="" width={11} height={7}/></span>}</button>
              {open && <div id={`assessment-${lesson.number}`}>{(["knowledge","application"] as const).map(kind=>{
                const summary=lesson[kind], finished=summary.status==="completed"||summary.status==="submitted";
                const status=locked?"—":summary.status==="not_started"?copy.available:summary.status==="in_progress"?copy.inProgress:summary.status==="submitted"?records.submitted:copy.completed;
                return <div className={`${styles.columns} ${styles.row}`} key={kind} data-assessment-kind={kind}>
                  <strong>{tests[kind]}</strong><span className={`${styles.status} ${finished?styles.green:summary.status==="not_started"||locked?styles.available:""} ${!locked&&summary.status!=="not_started"?styles.statusDot:""}`}>{status}</span>
                  <b data-latest-result>{locked||summary.latestResult==null?"—":typeof summary.latestResult==="number"?`${summary.latestResult}%`:copy.strong}</b>
                  {locked?<span className={styles.dash}>—</span>:<button type="button" onClick={()=>setModal({kind,lessonId:lesson.id})}>{finished?copy.viewResult:summary.status==="in_progress"?copy.continue:copy.start}</button>}
                </div>;
              })}</div>}
            </section>;
          })}</div>
        </section>
      </article>
    </div>
    {modal&&selected&&<PersistedAssessmentDialog key={`${modal.kind}:${selected.id}`} kind={modal.kind} locale={locale} courseId={courseId} lessonId={selected.id} lessonNumber={selected.number} lessonTitle={selected.title} knowledgeCompleted={selected.knowledge.status==="completed"} onExit={close}
      onNextLesson={nextLesson ? ()=>{const destination=new URL(backHref,window.location.origin);destination.searchParams.set("lessonId",nextLesson.id);window.location.assign(destination.pathname+destination.search);} : undefined}
      onApplicationTest={()=>{void refresh();setModal({kind:"application",lessonId:selected.id});}} onKnowledgeTest={()=>{void refresh();setModal({kind:"knowledge",lessonId:selected.id});}}/>}
  </div>;
}

"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import type { ExplorationDisplay, ExplorationLesson } from "@/contracts/exploration";
import type { LessonNode } from "@/contracts/lesson-content";
import { explorationCourseSamples, explorationLessonNumber } from "@/services/explorationSamples";
import { PortalDialog } from "./PortalDialog";
import { ExhibitDialog } from "./ExhibitDialog";
import { LessonModal, SafeLessonHtml } from "./CourseMediaPreview";
import styles from "./exploration-dialog.module.css";

function LockedExploration({locale,tab}:{locale:Locale;tab:"reading"|"exhibits"}) {
  const copy=getMessages(locale).exploration;
  const message=tab==="reading"?copy.moreReadings:copy.moreExhibits;
  return <div className={styles.lockedPreview} data-exploration-locked={tab} role="note" aria-label={message}>
    <div className={styles.ghostRows} data-exploration-ghost aria-hidden="true">{[0,1,2].map(row=><div className={styles.ghostRow} key={row}><div><span/><span/><span/></div><div className={styles.ghostDescription}/></div>)}</div>
    <div className={styles.lockedFade} aria-hidden="true"/>
    <p className={styles.lockedMessage}><Image src="/portal/exploration/lock.svg" width={16} height={16} alt=""/>{message}</p>
  </div>;
}

export function ExplorationDialog({locale,courseId,lessonNumber="01",lessons,tutorAvailable=true,onClose,onAskTutor,data}: {locale:Locale;courseId:string;lessonNumber?:string;lessons?:ExplorationLesson[];tutorAvailable?:boolean;onClose:()=>void;onAskTutor:()=>void;data?:ExplorationDisplay}) {
  const messages=getMessages(locale),copy=messages.exploration;
  const courseLessons=lessons??[{number:lessonNumber,title:copy.lesson.replace("{number}",String(Number(lessonNumber)||lessonNumber)),unlocked:true}];
  const unlocked=new Set(courseLessons.filter(lesson=>lesson.unlocked).map(lesson=>explorationLessonNumber(lesson.number)));
  const samples=data||explorationCourseSamples(locale,courseId,courseLessons);
  const [tab,setTab]=useState<"reading"|"exhibits">("reading"),[scope,setScope]=useState<"lesson"|"course">("lesson");
  const [selected,setSelected]=useState<LessonNode|null>(null);
  const scroll=useRef<HTMLDivElement>(null),position=useRef(0),selectedId=useRef("");
  useEffect(() => {
    if (selected || !scroll.current) return;
    scroll.current.scrollTop=position.current;
    if(selectedId.current)scroll.current.querySelector<HTMLButtonElement>(`[data-exhibit-id="${CSS.escape(selectedId.current)}"]`)?.focus({preventScroll:true});
  }, [selected]);
  const lesson=(number:string)=>courseLessons.find(item=>explorationLessonNumber(item.number)===number)?.title || copy.lesson.replace("{number}",String(Number(number)||number));
  const inScope=(item:{lessonNumber:string})=>unlocked.has(explorationLessonNumber(item.lessonNumber))&&(scope==="course"||explorationLessonNumber(item.lessonNumber)===explorationLessonNumber(lessonNumber));
  const readings=samples.readings.filter(inScope).map(item=>({...item,lessonNumber:explorationLessonNumber(item.lessonNumber)}));
  const exhibits=samples.exhibits.filter(inScope).map(item=>({...item,lessonNumber:explorationLessonNumber(item.lessonNumber)}));
  const numbers=[...new Set((tab==="reading"?readings:exhibits).map(item=>item.lessonNumber))];
  function changeTab(next:"reading"|"exhibits") {setTab(next);scroll.current?.scrollTo(0,0);}
  function changeScope(next:"lesson"|"course") {setScope(next);position.current=0;scroll.current?.scrollTo(0,0);}
  if(selected)return selected.type === "text" ? <LessonModal title={selected.title} locale={locale} onClose={()=>setSelected(null)}><SafeLessonHtml html={selected.html || ""}/></LessonModal> : <ExhibitDialog node={selected} locale={locale} onClose={()=>setSelected(null)}/>;
  return <PortalDialog className={styles.dialog} labelledBy="exploration-title" onClose={onClose}>
    <header className={styles.header}><div><h2 id="exploration-title">{copy.title}</h2></div><div className={styles.actions}>
      {tutorAvailable && <button type="button" className={styles.tutor} onClick={onAskTutor}><span><Image src="/portal/exploration/tutor.svg" width={14} height={14} alt=""/></span>{messages.previewVideoDesign.tutor}</button>}
      <div className={styles.scope} role="group" aria-label={copy.scope}>{(["lesson","course"] as const).map(value=><button type="button" key={value} aria-pressed={scope===value} onClick={()=>changeScope(value)}>{value==="lesson"?copy.thisLesson:copy.wholeCourse}</button>)}</div>
      <button type="button" className={styles.close} aria-label={copy.close} onClick={onClose}>×</button>
    </div></header>
    <div className={styles.tabs} role="tablist" aria-label={copy.title}>{(["reading","exhibits"] as const).map(value=><button type="button" role="tab" id={`exploration-tab-${value}`} aria-controls={`exploration-panel-${value}`} aria-selected={tab===value} tabIndex={tab===value?0:-1} onClick={()=>changeTab(value)} onKeyDown={event=>{if(["ArrowLeft","ArrowRight","Home","End"].includes(event.key)){event.preventDefault();const next=event.key==="Home"?"reading":event.key==="End"?"exhibits":tab==="reading"?"exhibits":"reading";changeTab(next);document.getElementById(`exploration-tab-${next}`)?.focus();}}} key={value}>{copy[value]}</button>)}</div>
    <div ref={scroll} className={styles.scroller} role="tabpanel" tabIndex={0} id={`exploration-panel-${tab}`} aria-labelledby={`exploration-tab-${tab}`} onScroll={event=>{position.current=event.currentTarget.scrollTop;}}>
      {numbers.map(number=><section className={styles.lessonGroup} key={number} aria-label={lesson(number)}>
        <h3 className={styles.lessonHeading}><span>{number.padStart(2,"0")}</span>{lesson(number)}</h3>
        {tab==="reading"?<div className={styles.readings}>{readings.filter(item=>item.lessonNumber===number).map(item=><article key={item.id}>
          <span className={styles.readingKind}>{copy[item.kind]}</span><div className={styles.readingTitle}><h4>{item.title}</h4><span className={styles.author}>{item.author}</span></div><p>{item.description}</p>
        </article>)}</div>:<div className={styles.grid}>{exhibits.filter(item=>item.lessonNumber===number).map(item=><article key={item.node.id}>
          <button type="button" className={styles.card} data-exhibit-id={item.node.id} aria-label={`${messages.videoExhibit.view}: ${item.node.title}`} onClick={()=>{position.current=scroll.current?.scrollTop||0;selectedId.current=item.node.id;setSelected(item.node);}}>
            <Image className={styles.thumbnail} src={item.thumbnail} unoptimized width={56} height={56} alt=""/><span className={styles.cardCopy}><span className={styles.kind}>{messages.videoExhibit.types[item.node.type]}</span><span className={styles.exhibitTitle}>{item.node.title}</span></span><Image src="/portal/exploration/arrow-right.svg" width={16} height={16} alt=""/>
          </button>
        </article>)}</div>}
      </section>)}
      {!numbers.length&&<p>{copy.empty}</p>}
      {scope==="course"&&courseLessons.some(lesson=>!lesson.unlocked)&&<LockedExploration locale={locale} tab={tab}/>}
    </div>
  </PortalDialog>;
}

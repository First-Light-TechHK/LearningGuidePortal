"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import type { ExplorationDisplay } from "@/contracts/exploration";
import type { LessonNode } from "@/contracts/lesson-content";
import { explorationSamples } from "@/services/explorationSamples";
import { PortalDialog } from "./PortalDialog";
import { ExhibitDialog } from "./ExhibitDialog";
import styles from "./exploration-dialog.module.css";

export function ExplorationDialog({locale,courseId,lessonNumber="01",onClose,onAskTutor,data}: {locale:Locale;courseId:string;lessonNumber?:string;onClose:()=>void;onAskTutor:()=>void;data?:ExplorationDisplay}) {
  const messages=getMessages(locale),copy=messages.exploration;
  const samples=data||explorationSamples(locale,courseId,lessonNumber);
  const [tab,setTab]=useState<"reading"|"exhibits">("reading"),[scope,setScope]=useState<"lesson"|"course">("lesson");
  const [selected,setSelected]=useState<LessonNode|null>(null);
  const scroll=useRef<HTMLDivElement>(null),position=useRef(0),selectedId=useRef("");
  useEffect(() => {
    if (selected || !scroll.current) return;
    scroll.current.scrollTop=position.current;
    if(selectedId.current)scroll.current.querySelector<HTMLButtonElement>(`[data-exhibit-id="${CSS.escape(selectedId.current)}"]`)?.focus({preventScroll:true});
  }, [selected]);
  const lesson=(number:string)=>copy.lesson.replace("{number}",String(Number(number)||number));
  const readings=samples.readings.filter(item=>scope==="course"||item.lessonNumber===lessonNumber);
  const exhibits=samples.exhibits.filter(item=>scope==="course"||item.lessonNumber===lessonNumber);
  function changeTab(next:"reading"|"exhibits") {setTab(next);scroll.current?.scrollTo(0,0);}
  if(selected)return <ExhibitDialog node={selected} locale={locale} onClose={()=>setSelected(null)}/>;
  return <PortalDialog className={styles.dialog} labelledBy="exploration-title" describedBy="exploration-description" onClose={onClose}>
    <header className={styles.header}><div><h2 id="exploration-title">{copy.title}</h2><p id="exploration-description">{copy.description}</p></div><div className={styles.actions}>
      <button type="button" className={styles.tutor} onClick={onAskTutor}><span><Image src="/portal/exploration/tutor.svg" width={14} height={14} alt=""/></span>{messages.previewVideoDesign.tutor}</button>
      <div className={styles.scope} role="group" aria-label={copy.scope}>{(["lesson","course"] as const).map(value=><button type="button" key={value} aria-pressed={scope===value} onClick={()=>setScope(value)}>{value==="lesson"?copy.thisLesson:copy.wholeCourse}</button>)}</div>
      <button type="button" className={styles.close} aria-label={copy.close} onClick={onClose}>×</button>
    </div></header>
    <div className={styles.tabs} role="tablist" aria-label={copy.title}>{(["reading","exhibits"] as const).map(value=><button type="button" role="tab" id={`exploration-tab-${value}`} aria-controls={`exploration-panel-${value}`} aria-selected={tab===value} tabIndex={tab===value?0:-1} onClick={()=>changeTab(value)} onKeyDown={event=>{if(["ArrowLeft","ArrowRight","Home","End"].includes(event.key)){event.preventDefault();const next=event.key==="Home"?"reading":event.key==="End"?"exhibits":tab==="reading"?"exhibits":"reading";changeTab(next);document.getElementById(`exploration-tab-${next}`)?.focus();}}} key={value}>{copy[value]}</button>)}</div>
    <div ref={scroll} className={styles.scroller} role="tabpanel" tabIndex={0} id={`exploration-panel-${tab}`} aria-labelledby={`exploration-tab-${tab}`} onScroll={event=>{position.current=event.currentTarget.scrollTop;}}>
      {tab==="reading"?<div className={styles.readings}>{readings.map(item=><article key={item.id}><div><span className={styles.readingKind}>{copy[item.kind]}</span><h3>{item.title}</h3><span className={styles.author}>{item.author}</span></div><p>{item.description}</p></article>)}{!readings.length&&<p>{copy.empty}</p>}</div>:<div className={styles.grid}>{exhibits.map(item=><article className={styles.card} key={item.node.id}><Image src={item.thumbnail} width={80} height={80} alt=""/><div><span className={styles.kind}>{messages.videoExhibit.types[item.node.type]}</span><h3>{item.node.title}</h3><p>{lesson(item.lessonNumber)}</p><button type="button" data-exhibit-id={item.node.id} onClick={()=>{position.current=scroll.current?.scrollTop||0;selectedId.current=item.node.id;setSelected(item.node);}}>{messages.videoExhibit.view} →</button></div></article>)}{!exhibits.length&&<p>{copy.empty}</p>}<Image src="/portal/exploration/locked-card.svg" width={308} height={111} alt=""/><Image src="/portal/exploration/locked-card.svg" width={308} height={111} alt=""/></div>}
    </div>
    {tab==="exhibits"&&<footer className={styles.notice}><p>{copy.future}</p><p>{copy.locked}</p></footer>}
  </PortalDialog>;
}

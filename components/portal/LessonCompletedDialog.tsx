"use client";

import Image from "next/image";
import { useState } from "react";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { PortalDialog } from "./PortalDialog";
import { KnowledgeTestDialog } from "./KnowledgeTestDialog";
import { ApplicationTestDialog } from "./ApplicationTestDialog";
import styles from "./lesson-completed-dialog.module.css";

export function LessonCompletedDialog({ locale, lessonNumber, onClose, onContinue = onClose }: { locale: Locale; lessonNumber: string; onClose: () => void; onContinue?: () => void }) {
  const copy = getMessages(locale).lessonCompleted;
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [applicationOpen, setApplicationOpen] = useState(false);
  if (knowledgeOpen) return <KnowledgeTestDialog locale={locale} lessonNumber={lessonNumber} onExit={() => setKnowledgeOpen(false)}/>;
  if (applicationOpen) return <ApplicationTestDialog locale={locale} lessonNumber={lessonNumber} onBack={() => setApplicationOpen(false)} onDone={onClose}/>;
  const tests = [{ title:copy.knowledge, description:copy.questions, icon:"knowledge", disabled:false }, { title:copy.application, description:copy.openResponse, icon:"application", disabled:false }, { title:copy.fluency, description:copy.courseAssessment, icon:"fluency", disabled:true }];
  return <PortalDialog className={styles.dialog} labelledBy="lesson-completed-title" describedBy="lesson-completed-description" onClose={onClose}>
    <Image className={styles.success} src="/portal/lesson-complete/success.svg" width={68} height={68} alt=""/>
    <h2 id="lesson-completed-title">{copy.title.replace("{number}", String(Number(lessonNumber) || lessonNumber))}</h2>
    <p className={styles.description} id="lesson-completed-description">{copy.description}</p>
    <div className={styles.tests}>{tests.map(test => <div className={`${styles.test} ${test.disabled ? styles.disabled : ""}`} key={test.icon}>
      <span className={styles.icon}><Image src={`/portal/lesson-complete/${test.icon}.svg`} width={test.icon === "knowledge" ? 24 : 26} height={test.icon === "knowledge" ? 24 : 26} alt=""/></span>
      <div className={styles.testCopy}><h3>{test.title}</h3><p>{test.description}{!test.disabled && <><Image className={styles.divider} src="/portal/lesson-complete/divider.svg" width={10} height={1} alt=""/><span>{copy.forLesson}</span></>}</p></div>
      <button type="button" className={styles.start} disabled={test.disabled} onClick={() => test.icon === "knowledge" ? setKnowledgeOpen(true) : setApplicationOpen(true)}>{test.disabled ? copy.comingSoon : copy.start}</button>
    </div>)}</div>
    <button type="button" className={styles.continue} onClick={onContinue}>{copy.continue}</button>
  </PortalDialog>;
}

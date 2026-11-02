"use client";

import Image from "next/image";
import { BookOpen } from "lucide-react";
import { useState } from "react";
import type { AssessmentAvailability } from "@/contracts/lesson-resources";
import type { Locale } from "@/lib/i18n/config";
import type { ApplicationTestAttempt } from "@/contracts/application-test";
import { getMessages } from "@/lib/i18n/messages";
import { PortalDialog } from "./PortalDialog";
import { KnowledgeTestDialog } from "./KnowledgeTestDialog";
import { ApplicationTestDialog } from "./ApplicationTestDialog";
import { PersistedAssessmentDialog } from "./PersistedAssessmentDialog";
import styles from "./lesson-completed-dialog.module.css";

export function LessonCompletedDialog({ locale, lessonNumber, lessonTitle, onClose, onContinue = onClose, courseId, lessonId, assessmentAvailability, nextLesson, isLastLesson = false }: { assessmentAvailability?: AssessmentAvailability; nextLesson?: { number: string; title: string }; locale: Locale; lessonNumber: string; lessonTitle?: string; onClose: () => void; onContinue?: () => void; courseId?: string; lessonId?: string; isLastLesson?: boolean }) {
  const copy = getMessages(locale).lessonCompleted;
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [applicationOpen, setApplicationOpen] = useState(false);
  const [knowledgeCompleted, setKnowledgeCompleted] = useState(false);
  const [applicationAttempt, setApplicationAttempt] = useState<ApplicationTestAttempt>();
  if ((knowledgeOpen || applicationOpen) && courseId && lessonId) return <PersistedAssessmentDialog key={knowledgeOpen ? "knowledge" : "application"} kind={knowledgeOpen ? "knowledge" : "application"} locale={locale} courseId={courseId} lessonId={lessonId} lessonNumber={lessonNumber} lessonTitle={lessonTitle} knowledgeCompleted={knowledgeCompleted}
    entrySource="lesson" onExit={() => { setKnowledgeOpen(false); setApplicationOpen(false); }} onNextLesson={onContinue}
    onApplicationTest={() => { setKnowledgeCompleted(true); setKnowledgeOpen(false); setApplicationOpen(true); }}
    onKnowledgeTest={() => { setApplicationOpen(false); setKnowledgeOpen(true); }}/>;
  if (knowledgeOpen) return <KnowledgeTestDialog locale={locale} lessonNumber={lessonNumber} lessonTitle={lessonTitle} onComplete={() => setKnowledgeCompleted(true)} onNextLesson={onContinue} onApplicationTest={() => { setKnowledgeCompleted(true); setKnowledgeOpen(false); setApplicationOpen(true); }} onExit={() => setKnowledgeOpen(false)}/>;
  if (applicationOpen) return <ApplicationTestDialog locale={locale} lessonNumber={lessonNumber} lessonTitle={lessonTitle} initialAttempt={applicationAttempt} onAttemptChange={setApplicationAttempt} knowledgeCompleted={knowledgeCompleted} onKnowledgeTest={() => { setApplicationOpen(false); setKnowledgeOpen(true); }} onNextLesson={onContinue} onBack={() => setApplicationOpen(false)} onDone={onClose}/>;
  const lessonLabel = (number: string, title?: string) => `${copy.lessonLabel.replace("{number}", String(Number(number) || number))}${title ? ` · ${title}` : ""}`;
  const tests = [{ title:copy.knowledge, description:assessmentAvailability ? copy.cards.replace(/\d+/, String(assessmentAvailability.knowledge)) : copy.cards, available: !assessmentAvailability || assessmentAvailability.knowledge > 0, icon:"knowledge-v2", size:26, action:() => setKnowledgeOpen(true) }, { title:copy.application, description:copy.questionCount, available: !assessmentAvailability || assessmentAvailability.application, icon:"application-v2", size:24, action:() => setApplicationOpen(true) }];
  return <PortalDialog portal className={styles.dialog} labelledBy="lesson-completed-title" describedBy="lesson-completed-description" onClose={onClose}>
    <button type="button" className={styles.close} aria-label={copy.close} onClick={onClose}><Image src="/portal/lesson-complete/close-v2.svg" width={18} height={18} alt=""/></button>
    <header className={styles.header}>
      <h2 id="lesson-completed-title">{copy.nextActionTitle}</h2>
      <p className={styles.description} id="lesson-completed-description">{lessonLabel(lessonNumber, lessonTitle)}</p>
    </header>
    <div className={styles.tests}>{tests.filter(test => test.available).map(test => <button type="button" className={styles.test} key={test.icon} onClick={test.action}>
      <span className={styles.icon}><Image src={`/portal/lesson-complete/${test.icon}.svg`} width={test.size} height={test.size} alt=""/></span>
      <span className={styles.testCopy}><strong>{test.title}</strong><span>{test.description}</span></span>
      <Image src="/portal/lesson-complete/arrow-right.svg" width={18} height={18} alt=""/>
    </button>)}
      <button type="button" className={styles.test} onClick={onContinue}>
        <span className={styles.icon}><BookOpen size={24} strokeWidth={2} aria-hidden="true"/></span>
        <span className={styles.testCopy}><strong>{isLastLesson ? copy.completeCourse : copy.nextLesson}</strong>{isLastLesson ? <span>{copy.returnToLearning}</span> : nextLesson ? <span>{lessonLabel(nextLesson.number, nextLesson.title)}</span> : null}</span>
        <Image src="/portal/lesson-complete/arrow-right.svg" width={18} height={18} alt=""/>
      </button>
    </div>
  </PortalDialog>;
}

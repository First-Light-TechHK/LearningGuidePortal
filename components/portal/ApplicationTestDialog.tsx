"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApplicationTestAttempt, ApplicationTestEntrySource } from "@/contracts/application-test";
import { APPLICATION_TEST_ANSWER_LIMIT } from "@/contracts/application-test";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { applicationEvaluationProgress, canSubmitApplicationAnswer, getApplicationTestSample, resolveApplicationAttempt } from "@/services/applicationTestSample";
import { PortalDialog } from "./PortalDialog";
import styles from "./application-test-dialog.module.css";

export function ApplicationTestDialog({ locale, lessonNumber, lessonTitle, onBack, onDone, onNextLesson, onKnowledgeTest, knowledgeCompleted = false, entrySource = "lesson", initialAnswer = "", initialView = "answer", initialAttempt, onAttemptChange, onSubmitAnswer, onEvaluationComplete, saveMessage, saveFailed, onRetrySave }: {
  locale: Locale; lessonNumber: string; lessonTitle?: string; onBack: () => void; onDone: () => void;
  onNextLesson?: () => void; onKnowledgeTest?: () => void; knowledgeCompleted?: boolean;
  entrySource?: ApplicationTestEntrySource;
  initialAnswer?: string; initialView?: "answer" | "result"; initialAttempt?: ApplicationTestAttempt;
  onAttemptChange?: (attempt: ApplicationTestAttempt) => void;
  onSubmitAnswer?: (answer: string) => Promise<void>; onEvaluationComplete?: (answer: string) => Promise<void>; saveMessage?: string; saveFailed?: boolean; onRetrySave?: () => void;
}) {
  const copy = getMessages(locale).applicationTest, common = getMessages(locale).knowledgeTest;
  const sample = getApplicationTestSample(locale);
  const [attempt, setAttempt] = useState<ApplicationTestAttempt>(() => {
    const initial = initialAttempt || { answer: initialAnswer, phase: initialView, startedAt: null };
    return onEvaluationComplete ? initial : resolveApplicationAttempt(initial, Date.now());
  });
  const [progress, setProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false), [submitError, setSubmitError] = useState("");
  const title = useRef<HTMLHeadingElement>(null);
  const submitLock = useRef(false), finishLock = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { answer, phase } = attempt;
  const finish = useCallback(async () => {
    if (finishLock.current) return;
    finishLock.current = true; setSubmitError("");
    try {
      await onEvaluationComplete?.(answer);
      if (mounted.current) setAttempt(current => ({ ...current, phase: "result" }));
    } catch { if (mounted.current) setSubmitError(getMessages(locale).assessmentRecords.saveError); }
  }, [answer, locale, onEvaluationComplete]);
  useEffect(() => { title.current?.focus(); }, [phase]);
  useEffect(() => { onAttemptChange?.(attempt); }, [attempt, onAttemptChange]);
  useEffect(() => {
    if (phase !== "evaluating" || attempt.startedAt === null) return;
    const tick = () => {
      const now = Date.now();
      setProgress(applicationEvaluationProgress(now - attempt.startedAt!));
      if (applicationEvaluationProgress(now - attempt.startedAt!) >= 100) void finish();
    };
    tick();
    const interval = window.setInterval(tick, 30);
    return () => window.clearInterval(interval);
  }, [phase, attempt.startedAt, finish]);
  async function submit() {
    if (phase !== "answer" || submitLock.current || !canSubmitApplicationAnswer(answer)) return;
    submitLock.current = true; setSubmitting(true); setSubmitError("");
    try {
      await onSubmitAnswer?.(answer);
      if (!mounted.current) return;
      finishLock.current = false; setProgress(0);
      setAttempt(current => ({ ...current, phase: "evaluating", startedAt: Date.now() }));
    } catch { if (mounted.current) { submitLock.current = false; setSubmitError(getMessages(locale).assessmentRecords.saveError); } }
    finally { if (mounted.current) setSubmitting(false); }
  }
  const next = onNextLesson || onDone;
  const fromOverview = entrySource === "overview";
  return <PortalDialog className={`${styles.dialog} ${fromOverview ? styles.overview : ""}`} labelledBy="application-test-title" onClose={onBack}>
    <header className={styles.header}>
      <div className={styles.headerSide}><button type="button" className={styles.back} onClick={onBack}><Image src="/portal/application-test/back-v2.svg" width={18} height={18} alt=""/>{phase === "result" ? (fromOverview ? copy.back : copy.resultBack) : common.exit}</button></div>
      <div className={styles.heading}><h2 ref={title} id="application-test-title" tabIndex={-1}>{copy.title}</h2><p>{common.lesson.replace("{number}", String(Number(lessonNumber) || lessonNumber))}{lessonTitle ? ` · ${lessonTitle}` : ""}</p></div>
      <div className={styles.headerSide}/>
    </header>
    <div className={styles.body}>
      <div className={styles.columns}>
        <section className={styles.question} aria-labelledby="application-question-title">
          <span className={styles.aiTag}>{copy.aiTutor}</span><h3 id="application-question-title">{common.question}</h3>
          <div className={styles.questionScroll} tabIndex={0}>{sample.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
        </section>
        <div className={styles.right}>
          {phase === "result" ? <>
            <div className={styles.resultScroll} tabIndex={0} aria-label={copy.feedback}>
              <section className={styles.feedback}><h3>{copy.feedback}</h3><strong>{copy.strongResponse}</strong>
                <div className={styles.strengths}><h4>{copy.strengths}</h4><p>{sample.strengths}</p></div>
                <div className={styles.improvement}><h4>{copy.improvement}</h4><p>{sample.improvement}</p></div>
              </section>
              <section className={styles.response}><h3>{copy.yourAnswer}</h3><p>{answer}</p></section>
              <section className={styles.reference}><h3>{common.reference}</h3>{sample.reference.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section>
            </div>
            <footer className={styles.resultFooter}>
              {fromOverview ? <button type="button" className={styles.primary} onClick={()=>{setAttempt({answer:"",phase:"answer",startedAt:null});setProgress(0);setSubmitError("");submitLock.current=false;finishLock.current=false;}}>{copy.retake}</button> : !knowledgeCompleted && onKnowledgeTest ? <><button type="button" className={styles.secondary} onClick={next}>{onNextLesson ? copy.nextLesson : common.done}</button><button type="button" className={styles.primary} onClick={onKnowledgeTest}>{copy.tryKnowledge}</button></>
                : <button type="button" className={styles.primary} onClick={next}>{onNextLesson ? copy.nextLesson : common.done}</button>}
            </footer>
          </> : <>
            <label className={styles.label} htmlFor="application-answer">{copy.yourAnswer}</label>
            <div className={`${styles.inputBox} ${phase === "evaluating" ? styles.readonly : ""}`}><textarea id="application-answer" placeholder={copy.placeholder} maxLength={APPLICATION_TEST_ANSWER_LIMIT} value={answer} readOnly={phase === "evaluating" || submitting} onChange={event => setAttempt(current => ({ ...current, answer: event.target.value }))}/></div>
            <div className={styles.meta}><span><Image src="/portal/application-test/saved-v2.svg" width={7} height={7} alt=""/>{saveMessage || common.saved}</span><span>{answer.length} / {APPLICATION_TEST_ANSWER_LIMIT}</span></div>
            {(submitError || saveFailed) && <p className={styles.saveError} role="alert">{submitError || saveMessage} {(saveFailed || phase === "evaluating") && <button type="button" onClick={() => { if (phase === "evaluating" && progress >= 100) { finishLock.current = false; void finish(); } else onRetrySave?.(); }}>{getMessages(locale).assessmentRecords.retry}</button>}</p>}
            {phase === "answer" ? <footer className={styles.actions}><button type="button" className={styles.primary} disabled={submitting || !canSubmitApplicationAnswer(answer)} onClick={() => void submit()}>{copy.submit}</button></footer>
              : <div className={styles.evaluation} role="status"><strong>{copy.evaluating}</strong><div className={styles.progress} role="progressbar" aria-label={copy.evaluating} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><div style={{ width:`${progress}%` }}/></div><p>{copy.evaluationNote}</p></div>}
          </>}
        </div>
      </div>
    </div>
  </PortalDialog>;
}

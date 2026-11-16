"use client";

import Image from "next/image";
import { normaliseApplicationResponseBand, type ApplicationAssessmentResult } from "@/contracts/application-assessment";
import { AssessmentAnswerInput, AssessmentText } from "./AssessmentAnswerInput";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApplicationTestAttempt, ApplicationTestEntrySource } from "@/contracts/application-test";
import { APPLICATION_TEST_ANSWER_LIMIT } from "@/contracts/application-test";
import type { ApplicationQuestion } from "@/contracts/lesson-resources";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { applicationEvaluationProgress, canSubmitApplicationAnswer, getApplicationTestSample, resolveApplicationAttempt } from "@/services/applicationTestSample";
import { PortalDialog } from "./PortalDialog";
import styles from "./application-test-dialog.module.css";

export function ApplicationTestDialog({ locale, lessonNumber, lessonTitle, onBack, onDone, onNextLesson, onKnowledgeTest, knowledgeCompleted = false, entrySource = "lesson", initialAnswer = "", initialView = "answer", initialAttempt, onAttemptChange, onSubmitAnswer, onEvaluationComplete, saveMessage, saveFailed, onRetrySave, question, onEvaluateAnswer, initialResult, submissionState, onRevise }: { question?: ApplicationQuestion;
  submissionState?: "pending" | "failed" | "unknown"; onRevise?: () => void;
  onEvaluateAnswer?: (answer: string) => Promise<ApplicationAssessmentResult>; initialResult?: ApplicationAssessmentResult;
  locale: Locale; lessonNumber: string; lessonTitle?: string; onBack: () => void; onDone: () => void;
  onNextLesson?: () => void; onKnowledgeTest?: () => void; knowledgeCompleted?: boolean;
  entrySource?: ApplicationTestEntrySource;
  initialAnswer?: string; initialView?: "answer" | "result"; initialAttempt?: ApplicationTestAttempt;
  onAttemptChange?: (attempt: ApplicationTestAttempt) => void;
  onSubmitAnswer?: (answer: string) => Promise<void>; onEvaluationComplete?: (answer: string) => Promise<void>; saveMessage?: string; saveFailed?: boolean; onRetrySave?: () => void;
}) {
  const copy = getMessages(locale).applicationTest, common = getMessages(locale).knowledgeTest;
  const sample = question ? { ...question, strengths: "", improvement: "" } : getApplicationTestSample(locale);
  const [attempt, setAttempt] = useState<ApplicationTestAttempt>(() => {
    const initial = initialAttempt || { answer: initialAnswer, phase: initialView, startedAt: null };
    return onEvaluateAnswer || onEvaluationComplete ? initial : resolveApplicationAttempt(initial, Date.now());
  });
  const [evaluation, setEvaluation] = useState(initialResult);
  const flow=getMessages(locale).assessmentFlow;
  const [confirmation,setConfirmation]=useState<"submit"|"clear"|null>(null);
  const cancelButton=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(confirmation)cancelButton.current?.focus();},[confirmation]);
  useEffect(()=>{if(initialResult){setEvaluation(initialResult);setAttempt(current=>({...current,answer:initialResult.yourAnswer,phase:"result"}));}},[initialResult]);
  const assessmentCopy = getMessages(locale).applicationAssessment;
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
  useEffect(() => { if (!onEvaluateAnswer || attempt.phase === "answer") onAttemptChange?.(attempt); }, [attempt, onAttemptChange, onEvaluateAnswer]);
  useEffect(() => {
    if (onEvaluateAnswer || phase !== "evaluating" || attempt.startedAt === null) return;
    const tick = () => {
      const now = Date.now();
      setProgress(applicationEvaluationProgress(now - attempt.startedAt!));
      if (applicationEvaluationProgress(now - attempt.startedAt!) >= 100) void finish();
    };
    tick();
    const interval = window.setInterval(tick, 30);
    return () => window.clearInterval(interval);
  }, [phase, attempt.startedAt, finish, onEvaluateAnswer]);
  async function submit() {
    if (phase !== "answer" || submitLock.current || !canSubmitApplicationAnswer(answer)) return;
    submitLock.current = true; setSubmitting(true); setSubmitError("");
    try {
      if (onEvaluateAnswer) {
        const result = await onEvaluateAnswer(answer);
        if (mounted.current) { setEvaluation(result); setAttempt(current => ({ ...current, phase: "result" })); }
        return;
      }
      await onSubmitAnswer?.(answer);
      if (!mounted.current) return;
      finishLock.current = false; setProgress(0);
      setAttempt(current => ({ ...current, phase: "evaluating", startedAt: Date.now() }));
    } catch (error) { if (mounted.current) { submitLock.current = false; setSubmitError(error instanceof Error ? error.message : flow.submissionError); } }
    finally { submitLock.current = false; if (mounted.current) setSubmitting(false); }
  }
  function beginRevision(){onRevise?.();setAttempt({answer,phase:"answer",startedAt:null});setProgress(0);setSubmitError("");submitLock.current=false;finishLock.current=false;}
  const next = onNextLesson || onDone;
  const fromOverview = entrySource === "overview";
  return <PortalDialog className={`${styles.dialog} ${fromOverview ? styles.overview : ""}`} labelledBy="application-test-title" onClose={onBack}>
    {confirmation && <PortalDialog labelledBy="assessment-confirm-title" describedBy="assessment-confirm-text" onClose={()=>setConfirmation(null)}>
      <h2 id="assessment-confirm-title">{confirmation==="submit"?flow.confirmTitle:flow.clearTitle}</h2>
      <p id="assessment-confirm-text">{confirmation==="submit"?flow.confirmText:flow.clearText}</p>
      <footer><button ref={cancelButton} type="button" onClick={()=>setConfirmation(null)}>{flow.cancel}</button><button type="button" onClick={()=>{const action=confirmation;setConfirmation(null);if(action==="submit")void submit();else {setSubmitError("");setAttempt(current=>({...current,answer:""}));}}}>{confirmation==="submit"?flow.confirm:flow.clearConfirm}</button></footer>
    </PortalDialog>}
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
              {!onEvaluateAnswer && !question && <section className={styles.feedback}><h3>{copy.feedback}</h3><strong>{copy.strongResponse}</strong>
                <div className={styles.strengths}><h4>{copy.strengths}</h4><p>{sample.strengths}</p></div>
                <div className={styles.improvement}><h4>{copy.improvement}</h4><p>{sample.improvement}</p></div>
              </section>}
              {onEvaluateAnswer ? evaluation ? <section className={styles.feedback}>
                <h3>{copy.feedback}</h3><strong>{assessmentCopy[normaliseApplicationResponseBand(evaluation.feedback.overallBand)]}</strong>
                {evaluation.feedback.needsReview && <p role="status">{evaluation.feedback.reviewReason || assessmentCopy.needsReview}</p>}
                <div className={styles.strengths}><h4>{copy.strengths}</h4>{evaluation.feedback.whatYouDidWell.length ? evaluation.feedback.whatYouDidWell.map((text,index)=><AssessmentText key={index} text={text} locale={locale}/>) : <p>{assessmentCopy.noStrengths}</p>}</div>
                <div className={styles.improvement}><h4>{copy.improvement}</h4>{evaluation.feedback.areasToImprove.length ? evaluation.feedback.areasToImprove.map((text,index)=><AssessmentText key={index} text={text} locale={locale}/>) : <p>{assessmentCopy.noImprovements}</p>}</div>
              </section> : <p role="status">{assessmentCopy.legacy}</p> : question && <p role="status">{getMessages(locale).assessmentRecords.submitted}</p>}
              <section className={styles.response}><h3>{copy.yourAnswer}</h3><AssessmentText text={answer} locale={locale}/></section>
              <section className={styles.reference}><h3>{common.reference}</h3>{onEvaluateAnswer ? evaluation?.referenceAnswer.status === "available" ? <AssessmentText text={evaluation.referenceAnswer.contentMarkdown} locale={locale}/> : <p>{assessmentCopy.referenceUnavailable}</p> : sample.reference.map((paragraph,index)=><AssessmentText key={index} text={paragraph} locale={locale}/>)}</section>
            </div>
            <footer className={styles.resultFooter}>{!fromOverview && <button type="button" className={styles.secondary} onClick={beginRevision}>{flow.revise}</button>}
              {fromOverview ? <button type="button" className={styles.primary} onClick={beginRevision}>{copy.retake}</button> : !knowledgeCompleted && onKnowledgeTest ? <><button type="button" className={styles.secondary} onClick={next}>{onNextLesson ? copy.nextLesson : common.done}</button><button type="button" className={styles.primary} onClick={onKnowledgeTest}>{copy.tryKnowledge}</button></>
                : <button type="button" className={styles.primary} onClick={next}>{onNextLesson ? copy.nextLesson : common.done}</button>}
            </footer>
          </> : <>
            <label className={styles.label} htmlFor="application-answer">{copy.yourAnswer}</label>
            <AssessmentAnswerInput className={`${styles.inputBox} ${phase === "evaluating" ? styles.readonly : ""}`} id="application-answer" locale={locale} placeholder={copy.placeholder} maxLength={APPLICATION_TEST_ANSWER_LIMIT} value={answer} readOnly={phase === "evaluating" || submitting || Boolean(submissionState)} onChange={value => {setSubmitError("");setAttempt(current => ({ ...current, answer: value }));}}/>
            <div className={styles.meta}><span><Image src="/portal/application-test/saved-v2.svg" width={7} height={7} alt=""/>{saveMessage || common.saved}</span><span>{answer.length} / {APPLICATION_TEST_ANSWER_LIMIT}</span></div>
            {(submitError || saveFailed) && <p className={styles.saveError} role="alert">{submitError || saveMessage} {(saveFailed || phase === "evaluating") && <button type="button" onClick={() => { if (phase === "evaluating" && progress >= 100) { finishLock.current = false; void finish(); } else onRetrySave?.(); }}>{getMessages(locale).assessmentRecords.retry}</button>}</p>}
            {(submitting || submissionState === "pending" || submissionState === "unknown") && <p role="status">{submissionState === "unknown" ? flow.submissionUnknown : copy.evaluating}</p>}
            {submissionState === "failed" && <button type="button" onClick={beginRevision}>{flow.revise}</button>}
            {phase === "answer" ? <footer className={styles.actions}><button type="button" className={styles.secondary} disabled={submitting || Boolean(submissionState)} onClick={()=>setConfirmation("clear")}>{flow.clear}</button><button type="button" className={styles.primary} disabled={submitting || submissionState === "pending" || submissionState === "unknown" || !canSubmitApplicationAnswer(answer)} onClick={() => submissionState === "failed" ? void submit() : setConfirmation("submit")}>{submissionState === "failed" ? getMessages(locale).assessmentRecords.retry : copy.submit}</button></footer>
              : <div className={styles.evaluation} role="status"><strong>{copy.evaluating}</strong><div className={styles.progress} role="progressbar" aria-label={copy.evaluating} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><div style={{ width:`${progress}%` }}/></div><p>{copy.evaluationNote}</p></div>}
          </>}
        </div>
      </div>
    </div>
  </PortalDialog>;
}

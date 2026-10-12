"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { ApplicationTestPhase } from "@/contracts/application-test";
import { APPLICATION_TEST_ANSWER_LIMIT, APPLICATION_TEST_EVALUATION_MS } from "@/contracts/application-test";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { applicationEvaluationProgress, canSubmitApplicationAnswer, getApplicationTestSample } from "@/services/applicationTestSample";
import { PortalDialog } from "./PortalDialog";
import shared from "./knowledge-test-dialog.module.css";
import styles from "./application-test-dialog.module.css";

export function ApplicationTestDialog({ locale, lessonNumber, onBack, onDone, initialAnswer = "", initialView = "answer" }: {
  locale: Locale; lessonNumber: string; onBack: () => void; onDone: () => void; initialAnswer?: string; initialView?: "answer" | "result";
}) {
  const copy = getMessages(locale).applicationTest, common = getMessages(locale).knowledgeTest;
  const sample = getApplicationTestSample(locale);
  const [answer, setAnswer] = useState(initialAnswer);
  const [phase, setPhase] = useState<ApplicationTestPhase>(initialView);
  const [progress, setProgress] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); }, [phase]);
  useEffect(() => {
    if (phase !== "evaluating") return;
    const start = performance.now();
    const interval = window.setInterval(() => setProgress(applicationEvaluationProgress(performance.now() - start)), 30);
    const finish = window.setTimeout(() => { setProgress(100); setPhase("result"); }, APPLICATION_TEST_EVALUATION_MS);
    return () => { window.clearInterval(interval); window.clearTimeout(finish); };
  }, [phase]);
  function submit() {
    if (phase !== "answer" || !canSubmitApplicationAnswer(answer)) return;
    setProgress(0); setPhase("evaluating");
  }
  return <PortalDialog className={`${shared.dialog} ${styles.dialog} ${phase === "result" ? styles.result : styles.test} ${expanded ? styles.expanded : ""}`} labelledBy="application-test-title" onClose={phase === "result" ? onDone : onBack}>
    <h2 ref={title} id="application-test-title" tabIndex={-1}>{phase === "result" ? common.result : copy.title}</h2>
    <p className={shared.meta}><span>{copy.apply}</span><Image src="/portal/lesson-complete/divider.svg" width={10} height={1} alt=""/><span>{common.lesson.replace("{number}", String(Number(lessonNumber) || lessonNumber))}</span></p>
    {phase === "evaluating" && <button type="button" className={styles.expand} aria-label={expanded ? copy.restore : copy.expand} aria-pressed={expanded} onClick={() => setExpanded(value => !value)}><Image src="/portal/application-test/expand.svg" width={26.8571} height={26.8571} alt=""/></button>}
    {phase === "result" ? <div className={styles.resultBody}>
      <h3>{copy.yourResponse}</h3><div className={styles.response}>{answer}</div>
      <h3 className={styles.overall}>{copy.overall}</h3>
      <div className={styles.assessment}><Image src="/portal/knowledge-test/score.svg" width={16} height={16} alt=""/><strong>{copy.strongResponse}</strong><span>{copy.latest}</span></div>
      <div className={styles.feedback}><section><h4>{copy.strengths}</h4><p>{sample.strengths}</p></section><section><h4>{copy.improvement}</h4><p>{sample.improvement}</p></section></div>
      <p className={styles.note}>{copy.retryNote}</p>
      <footer className={styles.resultFooter}><button type="button" className={`${shared.exit} ${styles.back}`} onClick={onBack}>{copy.back}</button><button type="button" className={shared.done} onClick={onDone}>{common.done}</button></footer>
    </div> : <div className={styles.testBody}>
      <div className={styles.intro}><span>{common.review}</span><span className={styles.aiBadge}>{copy.aiEvaluated}</span></div>
      <div className={styles.prompt}><p className={shared.label}>{common.question}</p><div>{sample.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div></div>
      <label className={shared.label} htmlFor="application-answer">{common.yourAnswer}</label>
      <div className={`${shared.inputBox} ${styles.inputBox}`}><textarea id="application-answer" placeholder={common.placeholder} maxLength={APPLICATION_TEST_ANSWER_LIMIT} value={answer} readOnly={phase === "evaluating"} onChange={event => setAnswer(event.target.value)}/><span>{answer.length}/{APPLICATION_TEST_ANSWER_LIMIT}</span></div>
      <p className={shared.saved}><Image src="/portal/knowledge-test/saved.svg" width={8} height={8} alt=""/>{common.saved}</p>
      <footer className={shared.footer}><button type="button" className={`${shared.exit} ${styles.back}`} onClick={onBack}>{copy.back}</button>
        {phase === "answer" ? <button type="button" className={`${shared.primary} ${styles.submit}`} disabled={!canSubmitApplicationAnswer(answer)} onClick={submit}>{copy.submit}</button> : <div className={styles.evaluation} role="status"><span>{copy.evaluating}</span><div className={styles.progress} role="progressbar" aria-label={copy.evaluating} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><div style={{ width:`${progress}%` }}/></div></div>}
      </footer>
      {phase === "evaluating" && <p className={styles.note}>{copy.evaluationNote}</p>}
    </div>}
  </PortalDialog>;
}

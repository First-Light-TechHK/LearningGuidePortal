"use client";

import Image from "next/image";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import type { KnowledgeRating, KnowledgeResponse, KnowledgeTestPhase } from "@/contracts/knowledge-test";
import type { KnowledgeAttempt } from "@/contracts/lesson-assessment";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { getKnowledgeTestSamples } from "@/lib/knowledgeTestSamples";
import { reviewKnowledgeResponses } from "@/lib/knowledgeTest";
import { PortalDialog } from "./PortalDialog";
import styles from "./knowledge-test-dialog-v2.module.css";

export function KnowledgeTestDialog({ locale, lessonNumber, lessonTitle, onExit, onNextLesson, onApplicationTest, onComplete, initialView = "question", initialAttempt, onAttemptChange, saveMessage, saveFailed, onRetrySave }: { locale: Locale; lessonNumber: string; lessonTitle?: string; onExit: () => void; onNextLesson?: () => void; onApplicationTest?: () => void; onComplete?: () => void; initialView?: "question" | "result"; initialAttempt?: KnowledgeAttempt; onAttemptChange?: (attempt: KnowledgeAttempt) => void; saveMessage?: string; saveFailed?: boolean; onRetrySave?: () => void }) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => { setPortalTarget(document.body); }, []);
  const copy = getMessages(locale).knowledgeTest;
  const questions = getKnowledgeTestSamples(locale);
  const [responses, setResponses] = useState<KnowledgeResponse[]>(() => initialAttempt?.responses || questions.map((question, position) => ({ answer: initialView === "result" ? question.referenceAnswer : "", rating: initialView === "result" ? (position === 0 || position >= 4 ? "right" : "wrong") : null })));
  const [index, setIndex] = useState(initialAttempt?.index || 0);
  const [phase, setPhase] = useState<KnowledgeTestPhase>(initialAttempt?.phase || initialView);
  useEffect(() => { if (phase !== "detail") onAttemptChange?.({ kind: "knowledge", responses, index, phase }); }, [responses, index, phase, onAttemptChange]);
  const resultScroll = useRef<number[]>([]);
  const lists = useRef<(HTMLDivElement | null)[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (phase === "result" && resultScroll.current.length) {
      lists.current.forEach((list, i) => { if (list) list.scrollTop = resultScroll.current[i] || 0; });
      document.getElementById(`knowledge-card-${index}`)?.focus({ preventScroll:true });
    } else heading.current?.focus();
  }, [phase, index, portalTarget]);
  const question = questions[index], response = responses[index];
  const result = reviewKnowledgeResponses(responses);
  const number = (value: number) => String(value + 1).padStart(2, "0");
  function update(patch: Partial<KnowledgeResponse>) {
    setResponses(current => current.map((value, position) => position === index ? { ...value, ...patch } : value));
  }
  function next() {
    if (!response.rating) return;
    if (index === questions.length - 1) { setPhase("result"); onComplete?.(); }
    else { setIndex(index + 1); setPhase("question"); }
  }
  function openCard(position: number) { resultScroll.current = lists.current.map(list => list?.scrollTop || 0); setIndex(position); setPhase("detail"); }
  const badge = (position: number, wrong = false) => <span className={`${styles.badge} ${wrong ? styles.orange : ""}`}>{number(position)}</span>;
  return portalTarget ? createPortal(<PortalDialog className={`${styles.dialog} ${phase === "result" ? styles.result : phase === "question" ? styles.front : styles.back}`} labelledBy="knowledge-test-title" onClose={phase === "detail" ? () => setPhase("result") : onExit}>
    {phase !== "detail" && <button type="button" className={styles.close} aria-label={copy.close} onClick={onExit}><Image src="/portal/knowledge-test/close-v2.svg" width={18} height={18} alt=""/></button>}
    <h2 ref={heading} tabIndex={-1} id="knowledge-test-title">{phase === "result" ? copy.result : copy.title}</h2>
    <p className={styles.meta}>{copy.lesson.replace("{number}", String(Number(lessonNumber) || lessonNumber))}{lessonTitle ? ` · ${lessonTitle}` : ""}</p>
    {saveFailed && <p role="alert">{saveMessage} <button onClick={onRetrySave}>{getMessages(locale).assessmentRecords.retry}</button></p>}
    {phase === "result" ? <>
      <div className={styles.scoreRow}><strong className={styles.score}>{result.percent}%</strong><p>{copy.correct.replace("{correct}", String(result.strong.length)).replace("{total}", String(questions.length))}</p></div>
      <div className={styles.columns}>{(["strong", "needsReview"] as const).map((kind, groupIndex) => <section key={kind} aria-label={copy[kind]}>
        <h3>{copy[kind]}<span>{copy.cards.replace("{count}", String(result[kind].length))}</span></h3>
        <div ref={node => { lists.current[groupIndex] = node; }} className={`${styles.list} ${kind === "needsReview" ? styles.needsReview : ""}`} tabIndex={0}>
          {result[kind].length === 0 && <p className={styles.empty}>{copy.emptyList}</p>}
          {result[kind].map(position => <button type="button" id={`knowledge-card-${position}`} key={questions[position].id} className={styles.card} onClick={() => openCard(position)}>{badge(position, kind === "needsReview")}<span>{questions[position].prompt}</span><Image src={`/portal/knowledge-test/${position === 0 ? "chevron-v2" : "chevron-muted-v2"}.svg`} width={16} height={16} alt=""/></button>)}
        </div>
      </section>)}</div>
      <footer className={styles.resultFooter}><button className={styles.exit} onClick={onNextLesson || onExit}>{onNextLesson ? copy.nextLesson : copy.done}</button>{onApplicationTest && <button className={styles.primary} onClick={onApplicationTest}>{copy.tryApplication} →</button>}</footer>
    </> : <div className={styles.body}>
      {phase !== "detail" && <><div className={styles.progressLabel}><span>{copy.review}</span><span>{number(index)}/{String(questions.length).padStart(2, "0")}</span></div>
      <div className={styles.track} role="progressbar" aria-label={copy.review} aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={index + 1}><span style={{ width: `${(index + 1) / questions.length * 100}%` }}/></div></>}
      <div className={styles.question}>{badge(index)}<p>{copy.question}</p><h3>{question.prompt}</h3></div>
      <label className={styles.label} htmlFor={phase === "question" ? "knowledge-answer" : undefined}>{phase === "question" ? copy.optionalNote : copy.yourNote}</label>
      {phase === "question" ? <>
        <div className={styles.inputBox}><textarea id="knowledge-answer" maxLength={2000} placeholder={copy.placeholder} value={response.answer} onChange={event => update({ answer: event.target.value })}/></div>
        <p className={styles.saved}><Image src="/portal/knowledge-test/saved-v2.svg" width={6} height={6} alt=""/>{saveMessage || copy.saved}</p>
      </> : <>
        <div className={styles.answer}>{response.answer || copy.emptyAnswer}</div>
        <p className={`${styles.label} ${styles.referenceLabel}`}>{copy.reference}</p><div className={styles.reference}>{question.referenceAnswer}</div>
        <fieldset className={`${styles.assessment} ${phase === "detail" ? styles.readOnly : ""}`} disabled={phase === "detail"}><legend>{phase === "detail" ? copy.youMarked : copy.selfAssessment}</legend><div>{(["wrong", "right"] as KnowledgeRating[]).map(rating => <label key={rating} className={response.rating === rating ? `${styles.selected} ${rating === "wrong" ? styles.wrong : styles.right}` : ""}><input type="radio" name="knowledge-rating" checked={response.rating === rating} onChange={() => update({ rating })}/><span aria-hidden="true">{rating === "wrong" ? "× " : "✓ "}</span>{copy[rating]}</label>)}</div></fieldset>
      </>}
      <footer className={styles.footer}><button className={styles.primary} disabled={phase === "answer" && !response.rating} onClick={() => { if (phase === "question") setPhase("answer"); else if (phase === "detail") setPhase("result"); else next(); }}>{phase === "question" ? copy.check : phase === "detail" ? copy.backToResults : index === questions.length - 1 ? copy.seeResults : copy.next}</button></footer>
    </div>}
  </PortalDialog>, portalTarget) : null;
}

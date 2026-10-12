"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { KnowledgeRating, KnowledgeResponse } from "@/contracts/knowledge-test";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { getKnowledgeTestSamples } from "@/lib/knowledgeTestSamples";
import { reviewKnowledgeResponses } from "@/lib/knowledgeTest";
import { PortalDialog } from "./PortalDialog";
import styles from "./knowledge-test-dialog.module.css";

export function KnowledgeTestDialog({ locale, lessonNumber, onExit, initialView = "question" }: { locale: Locale; lessonNumber: string; onExit: () => void; initialView?: "question" | "result" }) {
  const copy = getMessages(locale).knowledgeTest;
  const questions = getKnowledgeTestSamples(locale);
  const [responses, setResponses] = useState<KnowledgeResponse[]>(() => questions.map((question, position) => ({ answer: initialView === "result" ? question.referenceAnswer : "", rating: initialView === "result" ? (position === 0 || position >= 4 ? "right" : "wrong") : null })));
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"question" | "answer" | "result">(initialView);
  const [singleReview, setSingleReview] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [phase, index]);
  const question = questions[index], response = responses[index];
  const result = reviewKnowledgeResponses(responses);
  const number = (value: number) => String(value + 1).padStart(2, "0");
  function update(patch: Partial<KnowledgeResponse>) {
    setResponses(current => current.map((value, position) => position === index ? { ...value, ...patch } : value));
  }
  function next() {
    if (!response.rating) return;
    if (singleReview || index === questions.length - 1) { setPhase("result"); setSingleReview(false); }
    else { setIndex(index + 1); setPhase("question"); }
  }
  function openCard(position: number) { setIndex(position); setSingleReview(true); setPhase("answer"); }
  const badge = (position: number, wrong = false) => <span className={`${styles.badge} ${wrong ? styles.orange : ""}`}><Image src={`/portal/knowledge-test/${wrong ? "orange" : "blue"}-circle.svg`} width={24} height={24} alt=""/>{number(position)}</span>;
  return <PortalDialog className={`${styles.dialog} ${phase === "result" ? styles.result : ""}`} labelledBy="knowledge-test-title" onClose={onExit}>
    <h2 ref={heading} tabIndex={-1} id="knowledge-test-title">{phase === "result" ? copy.result : copy.title}</h2>
    <p className={styles.meta}><span>{copy.flashcards}</span><Image src="/portal/lesson-complete/divider.svg" width={10} height={1} alt=""/><span>{copy.lesson.replace("{number}", String(Number(lessonNumber) || lessonNumber))}</span></p>
    {phase === "result" ? <>
      <div className={styles.scoreRow}><strong className={styles.score}>{result.percent}%</strong><div className={styles.scoreCopy}><h3><Image src="/portal/knowledge-test/score.svg" width={16} height={16} alt=""/>{result.percent >= 80 ? copy.strongUnderstanding : copy.needsReview}</h3><p>{copy.correct.replace("{correct}", String(result.strong.length)).replace("{total}", String(questions.length))}<small>{copy.basedOn}</small></p></div><button className={styles.link} onClick={() => { setIndex(0); setSingleReview(false); setPhase("question"); }}>{copy.reviewAll} &gt;</button></div>
      <div className={styles.columns}>{(["strong", "needsReview"] as const).map(kind => <section key={kind} aria-label={copy[kind]}>
        <h3>{copy[kind]}<span>{copy.cards.replace("{count}", String(result[kind].length))}</span></h3>
        <div className={`${styles.list} ${kind === "needsReview" ? styles.needsReview : ""}`} tabIndex={0}>
          {result[kind].length === 0 && <p className={styles.empty}>{copy.emptyList}</p>}
          {result[kind].map(position => <article key={questions[position].id} className={styles.card}><div>{badge(position, kind === "needsReview")}<button className={styles.link} onClick={() => openCard(position)}>{copy.openCard} &gt;</button></div><p>{questions[position].prompt}</p></article>)}
        </div>
      </section>)}</div>
      <footer className={styles.resultFooter}><button className={styles.done} onClick={onExit}>{copy.done}</button></footer>
    </> : <div className={styles.body}>
      <div className={styles.progressLabel}><span>{copy.review}</span><span>{number(index)}/{String(questions.length).padStart(2, "0")}</span></div>
      <div className={styles.track} role="progressbar" aria-label={copy.review} aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={index + 1}><span style={{ width: `${(index + 1) / questions.length * 100}%` }}/></div>
      <div className={styles.question}>{badge(index)}<p>{copy.question}</p><h3>{question.prompt}</h3></div>
      <label className={styles.label} htmlFor={phase === "question" ? "knowledge-answer" : undefined}>{copy.yourAnswer}</label>
      {phase === "question" ? <>
        <div className={styles.inputBox}><textarea id="knowledge-answer" maxLength={2000} placeholder={copy.placeholder} value={response.answer} onChange={event => update({ answer: event.target.value })}/><span>{response.answer.length}/2000</span></div>
        <p className={styles.saved}><Image src="/portal/knowledge-test/saved.svg" width={8} height={8} alt=""/>{copy.saved}</p>
      </> : <>
        <div className={styles.answer}>{response.answer || copy.emptyAnswer}</div>
        <p className={`${styles.label} ${styles.referenceLabel}`}>{copy.reference}</p><div className={styles.reference}>{question.referenceAnswer}</div>
        <fieldset className={styles.assessment}><legend>{copy.selfAssessment}<span>{copy.mark}</span></legend><div>{(["wrong", "right"] as KnowledgeRating[]).map(rating => <label key={rating} className={response.rating === rating ? styles.selected : ""}><input type="radio" name="knowledge-rating" checked={response.rating === rating} onChange={() => update({ rating })}/>{copy[rating]}</label>)}</div></fieldset>
      </>}
      <footer className={styles.footer}><button className={styles.exit} onClick={onExit}>{copy.exit}</button><button className={styles.primary} disabled={phase === "answer" && !response.rating} onClick={() => phase === "question" ? setPhase("answer") : next()}>{phase === "question" ? copy.check : copy.next}</button></footer>
    </div>}
  </PortalDialog>;
}

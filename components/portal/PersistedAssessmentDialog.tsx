"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { createClientEventId } from "@/lib/clientEventId";
import type { AssessmentAttempt, AssessmentKind, SavedAssessment } from "@/contracts/lesson-assessment";
import type { ApplicationTestAttempt, ApplicationTestEntrySource } from "@/contracts/application-test";
import { KnowledgeTestDialog } from "./KnowledgeTestDialog";
import { ApplicationTestDialog } from "./ApplicationTestDialog";
import { PortalDialog } from "./PortalDialog";

export function PersistedAssessmentDialog({ locale, courseId, lessonId, lessonNumber, lessonTitle, kind, onExit, onApplicationTest, onKnowledgeTest, knowledgeCompleted = false, onNextLesson, entrySource = "overview" }: {
  locale: Locale; courseId: string; lessonId: string; lessonNumber: string; lessonTitle?: string; kind: AssessmentKind;
  onExit: () => void; onApplicationTest?: () => void; onKnowledgeTest?: () => void; knowledgeCompleted?: boolean; onNextLesson?: () => void; entrySource?: ApplicationTestEntrySource;
}) {
  const copy = getMessages(locale).assessmentRecords;
  const endpoint = `/api/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/assessments/${kind}`;
  const [loaded, setLoaded] = useState(false), [record, setRecord] = useState<SavedAssessment | null>(null);
  const [message, setMessage] = useState(copy.loading), [failed, setFailed] = useState(false);
  const [hasKnowledgeCompleted, setKnowledgeCompleted] = useState(knowledgeCompleted);
  const version = useRef(0), pending = useRef<AssessmentAttempt | null>(null), last = useRef("");
  const running = useRef<Promise<boolean> | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryBody = useRef<{ clientEventId: string; expectedVersion: number; attempt: AssessmentAttempt } | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const load = useCallback(async () => {
    setFailed(false); setMessage(copy.loading);
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error();
      if (kind === "application") {
        const knowledgeResponse = await fetch(endpoint.replace(/application$/, "knowledge"), { cache: "no-store" });
        if (knowledgeResponse.ok) {
          const knowledge = await knowledgeResponse.json();
          if (mounted.current) setKnowledgeCompleted(Boolean(knowledge.data?.completedAt||knowledge.data?.latestResult));
        }
      }
      if (!mounted.current) return;
      version.current = body.data?.version || 0;
      last.current = body.data ? JSON.stringify(body.data.attempt) : "";
      setRecord(body.data); setLoaded(true); setMessage(copy.saved);
    } catch { if (mounted.current) { setFailed(true); setMessage(copy.loadError); } }
  }, [endpoint, kind, copy.loading, copy.saved, copy.loadError]);
  useEffect(() => { void load(); }, [load]);
  const flush = useCallback((): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (running.current) return running.current;
    running.current = (async () => {
      while (retryBody.current || pending.current) {
        const attempt = retryBody.current?.attempt || pending.current!;
        if (!retryBody.current) {
          pending.current = null;
          if (JSON.stringify(attempt) === last.current) continue;
        }
        const body = retryBody.current || { clientEventId: createClientEventId(), expectedVersion: version.current, attempt };
        retryBody.current = body;
        if (mounted.current) { setFailed(false); setMessage(copy.saving); }
        try {
          const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true });
          const result = await response.json();
          if (!response.ok || !result.ok) throw new Error(response.status === 409 ? copy.conflict : copy.saveError);
          version.current = result.data.version; last.current = JSON.stringify(attempt); retryBody.current = null;
          if (mounted.current) setMessage(copy.saved);
        } catch (error) {
          if (mounted.current) { setFailed(true); setMessage(error instanceof Error && error.message === copy.conflict ? copy.conflict : copy.saveError); }
          return false;
        }
      }
      return true;
    })().finally(() => { running.current = null; });
    return running.current;
  }, [endpoint, copy.saving, copy.saved, copy.conflict, copy.saveError]);
  const update = useCallback((attempt: AssessmentAttempt) => {
    if (JSON.stringify(attempt) === last.current && !pending.current) return;
    pending.current = attempt;
    if (mounted.current) setMessage(copy.saving);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 250);
  }, [copy.saving, flush]);
  useEffect(() => {
    const save = () => { void flush(); };
    const hidden = () => { if (document.visibilityState === "hidden") save(); };
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("pagehide", save); document.removeEventListener("visibilitychange", hidden); save(); };
  }, [flush]);
  const updateApplication = useCallback((attempt: ApplicationTestAttempt) => update({ kind: "application", answer: attempt.answer, phase: attempt.phase === "result" ? "submitted" : attempt.phase }), [update]);
  const startReview = useCallback(async (answer: string) => {
    // A previously failed draft is retried before reserving the review state.
    if (!(await flush())) throw new Error(copy.saveError);
    update({ kind: "application", answer, phase: "evaluating" });
    if (!(await flush())) throw new Error(copy.saveError);
  }, [flush, update, copy.saveError]);
  const finishReview = useCallback(async (answer: string) => {
    update({ kind: "application", answer, phase: "submitted" });
    if (!(await flush())) throw new Error(copy.saveError);
  }, [flush, update, copy.saveError]);
  const leave = async (action = onExit) => { if (await flush()) action(); };
  const persistence = { saveMessage: message, saveFailed: failed, onRetrySave: () => { void flush(); } };
  if (!loaded) return <PortalDialog labelledBy="assessment-loading" onClose={onExit}><h2 id="assessment-loading">{copy.loading}</h2>{failed ? <p role="alert">{message}</p> : <div role="status" aria-label={copy.loading}><span aria-hidden="true" className="portal-dialog-spinner"/></div>}<footer>{failed && <button onClick={() => void load()}>{copy.retry}</button>}<button onClick={onExit}>{getMessages(locale).learning.close}</button></footer></PortalDialog>;
  if (kind === "knowledge") return <KnowledgeTestDialog locale={locale} lessonNumber={lessonNumber} lessonTitle={lessonTitle} entrySource={entrySource}
    initialAttempt={record?.attempt.kind === "knowledge" ? { ...record.attempt, phase: record.completedAt ? "result" : record.attempt.phase } : undefined} onAttemptChange={update} {...persistence}
    onExit={() => void leave()} onApplicationTest={onApplicationTest ? () => void leave(onApplicationTest) : undefined} onNextLesson={onNextLesson ? () => void leave(onNextLesson) : undefined}/>;
  const application = record?.attempt.kind === "application" ? record.attempt : null;
  return <ApplicationTestDialog locale={locale} lessonNumber={lessonNumber} lessonTitle={lessonTitle} entrySource={entrySource} knowledgeCompleted={hasKnowledgeCompleted}
    initialAttempt={application ? { answer: application.answer, phase: application.phase === "submitted" ? "result" : application.phase, startedAt: record?.evaluationStartedAt ? Date.parse(record.evaluationStartedAt) : null } : undefined}
    onAttemptChange={updateApplication}
    onSubmitAnswer={startReview} onEvaluationComplete={finishReview}
    {...persistence} onBack={() => void leave()} onDone={() => void leave()} onNextLesson={onNextLesson ? () => void leave(onNextLesson) : undefined} onKnowledgeTest={onKnowledgeTest ? () => void leave(onKnowledgeTest) : undefined}/>;
}

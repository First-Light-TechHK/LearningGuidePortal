"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApplicationAssessmentResult } from "@/contracts/application-assessment";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { createClientEventId } from "@/lib/clientEventId";
import type { AssessmentAttempt, AssessmentKind, SavedAssessment } from "@/contracts/lesson-assessment";
import type { ApplicationTestAttempt, ApplicationTestEntrySource } from "@/contracts/application-test";
import { KnowledgeTestDialog } from "./KnowledgeTestDialog";
import { ApplicationTestDialog } from "./ApplicationTestDialog";
import { PortalDialog } from "./PortalDialog";
import type { LessonAssessments } from "@/contracts/lesson-resources";

export function PersistedAssessmentDialog({ locale, courseId, lessonId, lessonNumber, lessonTitle, kind, onExit, onApplicationTest, onKnowledgeTest, knowledgeCompleted = false, onNextLesson, entrySource = "overview" }: {
  locale: Locale; courseId: string; lessonId: string; lessonNumber: string; lessonTitle?: string; kind: AssessmentKind;
  onExit: () => void; onApplicationTest?: () => void; onKnowledgeTest?: () => void; knowledgeCompleted?: boolean; onNextLesson?: () => void; entrySource?: ApplicationTestEntrySource;
}) {
  const flow = getMessages(locale).assessmentFlow;
  const copy = {...getMessages(locale).assessmentRecords,saveError:flow.draftError};
  const submitting = useRef(false);
  const endpoint = `/api/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/assessments/${kind}`;
  const [loaded, setLoaded] = useState(false), [record, setRecord] = useState<SavedAssessment | null>(null);
  const recordRef=useRef(record);recordRef.current=record;
  const [definition, setDefinition] = useState<LessonAssessments>();
  const [message, setMessage] = useState(copy.loading), [failed, setFailed] = useState(false);
  const [hasKnowledgeCompleted, setKnowledgeCompleted] = useState(knowledgeCompleted);
  const version = useRef(0), pending = useRef<AssessmentAttempt | null>(null), last = useRef("");
  const running = useRef<Promise<boolean> | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryBody = useRef<{ clientEventId: string; expectedVersion: number; attempt: AssessmentAttempt } | null>(null);
  const [uncertain,setUncertain]=useState(false);
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
      last.current = body.data ? JSON.stringify(body.data.evaluation?.status === "pending" ? {...body.data.attempt,phase:"answer"} : body.data.attempt) : "";
      setUncertain(false);setRecord(body.data); setDefinition(body.definition); setLoaded(true); setMessage(body.data ? copy.saved : flow.clean);
    } catch { if (mounted.current) { setFailed(true); setMessage(copy.loadError); } }
  }, [endpoint, kind, copy.loading, copy.saved, copy.loadError]);
  useEffect(() => { void load(); }, [load]);
  useEffect(()=>{if(record?.evaluation?.status!=="pending"&&!uncertain)return;const id=setInterval(()=>{void load();},2000);return()=>clearInterval(id);},[record?.evaluation?.status,uncertain,load]);
  const flush = useCallback((): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (submitting.current) return Promise.resolve(false);
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
          if (mounted.current) {setFailed(false);setMessage(pending.current ? flow.dirty : copy.saved);}
        } catch (error) {
          if (mounted.current) { setFailed(true); setMessage(error instanceof Error && error.message === copy.conflict ? copy.conflict : copy.saveError); }
          return false;
        }
      }
      return true;
    })().finally(() => { running.current = null; });
    return running.current;
  }, [endpoint, copy.saving, copy.saved, copy.conflict, copy.saveError, flow.dirty]);
  const update = useCallback((attempt: AssessmentAttempt) => {
    if (JSON.stringify(attempt) === last.current && !pending.current) return;
    if (!last.current && attempt.kind === "application" && !attempt.answer) {last.current=JSON.stringify(attempt);return;}
    pending.current = attempt;
    if (mounted.current) {setFailed(false);setMessage(flow.dirty);}
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 3000);
  }, [flow.dirty, flush]);
  useEffect(() => {
    const save = () => { void flush(); };
    const hidden = () => { if (document.visibilityState === "hidden") save(); };
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("pagehide", save); document.removeEventListener("visibilitychange", hidden); save(); };
  }, [flush]);
  const updateApplication = useCallback((attempt: ApplicationTestAttempt) => update({ kind: "application", answer: attempt.answer, phase: attempt.phase === "result" ? "submitted" : attempt.phase }), [update]);
  const evaluationEvent = useRef<{answer: string; id: string} | null>(null);
  const evaluate = useCallback(async (answer: string): Promise<ApplicationAssessmentResult> => {
    const record=recordRef.current;
    if (timer.current) {clearTimeout(timer.current);timer.current=null;}
    if (submitting.current) throw new Error(flow.submissionError);
    submitting.current=true;
    try {
      if (running.current) await running.current;
      // An uncertain autosave must be reconciled before using its version.
      if (retryBody.current) {
        const response=await fetch(endpoint,{cache:"no-store"});const state=await response.json();
        if(!response.ok||!state.ok)throw new Error(flow.submissionUnknown);
        version.current=state.data?.version||0;retryBody.current=null;
      }
      pending.current=null;setFailed(false);setMessage(flow.submitting);
      if (!evaluationEvent.current || evaluationEvent.current.answer !== answer) evaluationEvent.current = {answer,id:record?.evaluation && record.attempt.kind === "application" && record.attempt.answer === answer && record.evaluation.status !== "done" ? record.evaluation.eventId : createClientEventId()};
      let response:Response;
      try {response=await fetch(`${endpoint}/evaluate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({clientEventId:evaluationEvent.current.id,expectedVersion:version.current,attempt:{kind:"application",answer,phase:"answer"},locale:record?.evaluation?.eventId===evaluationEvent.current.id ? record.evaluation.locale || locale : locale})});}
      catch {
        setUncertain(true);
        try {
          const check=await fetch(endpoint,{cache:"no-store"});const state=await check.json();
          if(!check.ok||!state.ok)throw new Error();
          version.current=state.data?.version||0;last.current=JSON.stringify(state.data?.attempt);setRecord(state.data);setUncertain(false);
          if(state.data?.evaluation?.eventId===evaluationEvent.current.id&&state.data.evaluation.result){evaluationEvent.current=null;return state.data.evaluation.result;}
          throw new Error(state.data?.evaluation?.eventId===evaluationEvent.current.id?flow.evaluationError:flow.submissionError);
        } catch(error) {throw error instanceof Error&&[flow.evaluationError,flow.submissionError].includes(error.message)?error:new Error(flow.submissionUnknown);}
      }
      let body;try{body=await response.json();}catch{setUncertain(true);throw new Error(flow.submissionUnknown);}
      if(!response.ok||!body.ok||!body.data?.evaluation?.result){
        const stateResponse=await fetch(endpoint,{cache:"no-store"});const state=await stateResponse.json();
        if(!stateResponse.ok||!state.ok)throw new Error(flow.submissionUnknown);
        version.current=state.data?.version||0;last.current=JSON.stringify(state.data?.attempt);
        if(mounted.current){setRecord(state.data);setMessage(state.data?.attempt?.answer===answer?copy.saved:flow.dirty);}
        throw new Error(state.data?.evaluation?.eventId===evaluationEvent.current.id?flow.evaluationError:flow.submissionError);
      }
      version.current=body.data.version;last.current=JSON.stringify(body.data.attempt);
      if(mounted.current){setRecord(body.data);setMessage(copy.saved);}
      evaluationEvent.current=null;return body.data.evaluation.result;
    } finally {submitting.current=false;}
  },[endpoint,locale,copy.saved,flow]);
  const leave = async (action = onExit) => { if (submitting.current || record?.evaluation?.status === "pending" || uncertain || await flush()) action(); };
  const persistence = { saveMessage: message, saveFailed: failed, onRetrySave: () => { void flush(); } };
  if (!loaded) return <PortalDialog labelledBy="assessment-loading" onClose={onExit}><h2 id="assessment-loading">{copy.loading}</h2>{failed ? <p role="alert">{message}</p> : <div role="status" aria-label={copy.loading}><span aria-hidden="true" className="portal-dialog-spinner"/></div>}<footer>{failed && <button onClick={() => void load()}>{copy.retry}</button>}<button onClick={onExit}>{getMessages(locale).learning.close}</button></footer></PortalDialog>;
  if (kind === "knowledge") return <KnowledgeTestDialog questions={definition?.knowledge} locale={locale} lessonNumber={lessonNumber} lessonTitle={lessonTitle} entrySource={entrySource}
    initialAttempt={record?.attempt.kind === "knowledge" ? { ...record.attempt, phase: record.completedAt ? "result" : record.attempt.phase } : undefined} onAttemptChange={update} {...persistence}
    onExit={() => void leave()} onApplicationTest={onApplicationTest ? () => void leave(onApplicationTest) : undefined} onNextLesson={onNextLesson ? () => void leave(onNextLesson) : undefined}/>;
  const application = record?.attempt.kind === "application" ? record.attempt : null;
  return <ApplicationTestDialog question={definition?.application || undefined} locale={locale} lessonNumber={lessonNumber} lessonTitle={lessonTitle} entrySource={entrySource} knowledgeCompleted={hasKnowledgeCompleted}
    initialAttempt={application ? { answer: application.answer, phase: application.phase === "submitted" ? "result" : "answer", startedAt: record?.evaluationStartedAt ? Date.parse(record.evaluationStartedAt) : null } : undefined}
    onAttemptChange={updateApplication}
    onEvaluateAnswer={evaluate} initialResult={application?.phase === "submitted" ? record?.evaluation?.result || record?.submissions?.findLast(item=>item.result)?.result : undefined}
    submissionState={uncertain ? "unknown" : record?.evaluation?.status === "pending" || record?.evaluation?.status === "failed" ? (record.evaluation.status === "pending" && !(Date.now()-Date.parse(record.evaluation.startedAt)<90000) ? "failed" : record.evaluation.status) : undefined}
    onRevise={()=>{if(record){evaluationEvent.current=null;last.current="";setRecord({...record,evaluation:undefined,attempt:{kind:"application",answer:application?.answer||"",phase:"answer"}});update({kind:"application",answer:application?.answer||"",phase:"answer"});}}}
    {...persistence} onBack={() => void leave()} onDone={() => void leave()} onNextLesson={onNextLesson ? () => void leave(onNextLesson) : undefined} onKnowledgeTest={onKnowledgeTest ? () => void leave(onKnowledgeTest) : undefined}/>;
}

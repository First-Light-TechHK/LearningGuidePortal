"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { LessonCompletedDialog } from "./LessonCompletedDialog";
import { useRouter } from "next/navigation";
import type { AssessmentAvailability } from "@/contracts/lesson-resources";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import styles from "./lesson-completion.module.css";
import { completeLessonOutline } from "@/lib/completeLessonOutline";
import { createClientEventId } from "@/lib/clientEventId";

export function LessonCompletionBar({ onCompleted, locale, courseId, lessonId, lessonNumber, lessonTitle, nextLesson, percentage, seconds, initialCompleted, assessmentAvailability, visible = true, contentId, endedRequest = 0, nextHref = null, endpoint = "/api/study/events" }: {
  onCompleted?: () => void;
  assessmentAvailability?: AssessmentAvailability;
  nextLesson?: { number: string; title: string };
  locale: Locale; courseId: string; lessonId: string; lessonNumber: string; lessonTitle?: string; percentage: number; seconds: number; initialCompleted: boolean;
  endpoint?: "/api/study/events" | "/api/study/preview";
  visible?: boolean; contentId?: string; endedRequest?: number;
  nextHref?: string | null;
}) {
  const router = useRouter(), messages = getMessages(locale), copy = messages.videoCompletion;
  const [completed, setCompleted] = useState(initialCompleted), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const inFlight = useRef(false), saved = useRef(initialCompleted), handledEnd = useRef(0);
  const continueRequest = useRef<string | null>(null), continueLock = useRef(false);
  const [continuationFailed, setContinuationFailed] = useState(false);
  async function continueLesson() {
    if (continueLock.current) return;
    continueLock.current = true; setBusy(true); setError(""); setContinuationFailed(false);
    continueRequest.current ||= createClientEventId();
    try {
      await completeLessonOutline(endpoint, courseId, lessonId, "video", continueRequest.current);
      setDialogOpen(false); router.push(nextHref || `/${locale}/account/my-learning`);
    } catch {
      continueLock.current = false; setDialogOpen(false); setContinuationFailed(true); setError(messages.overviewDesign.previewSaveError);
    } finally { setBusy(false); }
  }
  useEffect(() => {
    if (dialogOpen && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, [dialogOpen]);
  const percent = String(Math.floor(Math.min(100, percentage)));
  const complete = useCallback(async (showDialog = true) => {
    if (inFlight.current) return;
    if (saved.current || initialCompleted) { if (showDialog) setDialogOpen(true); return; }
    inFlight.current = true;
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId, lessonId, ...(contentId ? {contentId,learningMode:"video"} : {}), event: "complete", seconds, clientEventId: `complete_${courseId}_${lessonId}_${contentId || "legacy"}` }) });
      if (!response.ok) throw new Error();
      saved.current = true; onCompleted?.(); setCompleted(true); if (showDialog || handledEnd.current > 0) setDialogOpen(true); router.refresh();
    } catch { setError(messages.overviewDesign.previewSaveError); }
    finally { inFlight.current = false; setBusy(false); }
  }, [onCompleted, courseId, lessonId, contentId, seconds, endpoint, initialCompleted, messages.overviewDesign.previewSaveError, router]);
  useEffect(() => {
    if (endedRequest > handledEnd.current) { handledEnd.current = endedRequest; void complete(); }
  }, [endedRequest, complete]);
  const autoAttempted = useRef(false);
  useEffect(() => {
    if (percentage >= 98 && !autoAttempted.current && !saved.current && !initialCompleted) {
      autoAttempted.current = true;
      void complete(false);
    }
  }, [percentage, initialCompleted, complete]);
  const showBar = visible || completed || initialCompleted;
  return <>{showBar && <section className={styles.bar} aria-label={copy.label} data-completed={completed || initialCompleted}>
    {completed || initialCompleted ? <span className={styles.completed}><Image src="/portal/lesson-complete/check-filled.svg" width={16} height={16} alt=""/>{messages.learning.completed}</span> : <>
      <Image src="/portal/lesson-complete/check-circle.svg" width={16} height={16} alt=""/>
      <span className={styles.percent}>{percent}%</span><span className={styles.divider} aria-hidden="true"/>
      <button type="button" className={styles.complete} disabled={busy} onClick={() => void complete()}>{busy ? messages.learning.processing : copy.markComplete}</button>
    </>}
    {error && <p className={styles.error} role="alert">{error}{continuationFailed && <button type="button" disabled={busy} onClick={() => void continueLesson()}>{messages.assessmentRecords.retry}</button>}</p>}
  </section>}{!showBar && error && <div role="alert"><p>{error}</p><button type="button" className={styles.complete} disabled={busy} onClick={() => void complete()}>{busy ? messages.learning.processing : copy.markComplete}</button></div>}{dialogOpen && <LessonCompletedDialog nextLesson={nextLesson} isLastLesson={nextHref === null} assessmentAvailability={assessmentAvailability} courseId={courseId} lessonId={lessonId} lessonTitle={lessonTitle} locale={locale} lessonNumber={lessonNumber} onClose={() => setDialogOpen(false)} onContinue={() => void continueLesson()}/>}</>;
}

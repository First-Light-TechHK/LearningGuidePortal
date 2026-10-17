"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { LessonCompletedDialog } from "./LessonCompletedDialog";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import styles from "./lesson-completion.module.css";
import { completeLessonOutline } from "@/lib/completeLessonOutline";
import { createClientEventId } from "@/lib/clientEventId";

export function LessonCompletionBar({ locale, courseId, lessonId, lessonNumber, lessonTitle, percentage, seconds, initialCompleted, visible = true, contentId, endedRequest = 0, nextHref = null, endpoint = "/api/study/events" }: {
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
    if (visible && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, [visible]);
  const percent = String(Math.floor(Math.min(100, percentage)));
  const complete = useCallback(async () => {
    if (inFlight.current) return;
    if (saved.current || initialCompleted) { setDialogOpen(true); return; }
    inFlight.current = true;
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId, lessonId, ...(contentId ? {contentId,learningMode:"video"} : {}), event: "complete", seconds, clientEventId: `complete_${courseId}_${lessonId}_${contentId || "legacy"}` }) });
      if (!response.ok) throw new Error();
      saved.current = true; setCompleted(true); setDialogOpen(true); router.refresh();
    } catch { setError(messages.overviewDesign.previewSaveError); }
    finally { inFlight.current = false; setBusy(false); }
  }, [courseId, lessonId, contentId, seconds, endpoint, initialCompleted, messages.overviewDesign.previewSaveError, router]);
  useEffect(() => {
    if (endedRequest > handledEnd.current) { handledEnd.current = endedRequest; void complete(); }
  }, [endedRequest, complete]);
  const showBar = visible || completed;
  return <>{showBar && <section className={styles.bar} aria-label={copy.label} data-completed={completed}>
    {completed ? <span className={styles.completed}><Image src="/portal/lesson-complete/check-filled.svg" width={16} height={16} alt=""/>{messages.learning.completed}</span> : <>
      <Image src="/portal/lesson-complete/check-circle.svg" width={16} height={16} alt=""/>
      <span className={styles.percent}>{percent}%</span><span className={styles.divider} aria-hidden="true"/>
      <button type="button" className={styles.complete} disabled={busy} onClick={() => void complete()}>{busy ? messages.learning.processing : copy.markComplete}</button>
    </>}
    {error && <p className={styles.error} role="alert">{error}{continuationFailed && <button type="button" disabled={busy} onClick={() => void continueLesson()}>{messages.assessmentRecords.retry}</button>}</p>}
  </section>}{!showBar && error && <div role="alert"><p>{error}</p><button type="button" className={styles.complete} disabled={busy} onClick={() => void complete()}>{busy ? messages.learning.processing : copy.markComplete}</button></div>}{dialogOpen && <LessonCompletedDialog courseId={courseId} lessonId={lessonId} lessonTitle={lessonTitle} locale={locale} lessonNumber={lessonNumber} onClose={() => setDialogOpen(false)} onContinue={() => void continueLesson()}/>}</>;
}

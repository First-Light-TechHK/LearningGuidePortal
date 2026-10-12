"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LessonCompletedDialog } from "./LessonCompletedDialog";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import styles from "./lesson-completion.module.css";

export function LessonCompletionBar({ locale, courseId, lessonId, lessonNumber, percentage, seconds, initialCompleted, visible = true, contentId, endedRequest = 0, nextHref = null, endpoint = "/api/study/events" }: {
  locale: Locale; courseId: string; lessonId: string; lessonNumber: string; percentage: number; seconds: number; initialCompleted: boolean;
  endpoint?: "/api/study/events" | "/api/study/preview";
  visible?: boolean; contentId?: string; endedRequest?: number;
  nextHref?: string | null;
}) {
  const router = useRouter(), messages = getMessages(locale), copy = messages.videoCompletion;
  const [dismissed, setDismissed] = useState(false), [completed, setCompleted] = useState(initialCompleted), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const inFlight = useRef(false), saved = useRef(initialCompleted), handledEnd = useRef(0);
  useEffect(() => { setDismissed(false); }, [contentId]);
  useEffect(() => {
    if (visible && !dismissed && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, [visible, dismissed]);
  const percent = String(Math.floor(Math.min(100, percentage)));
  const complete = useCallback(async () => {
    if (inFlight.current) return;
    if (saved.current || initialCompleted) { setDialogOpen(true); return; }
    inFlight.current = true;
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId, lessonId, event: "complete", seconds, clientEventId: `complete_${courseId}_${lessonId}` }) });
      if (!response.ok) throw new Error();
      saved.current = true; setCompleted(true); setDialogOpen(true); router.refresh();
    } catch { setError(messages.overviewDesign.previewSaveError); }
    finally { inFlight.current = false; setBusy(false); }
  }, [courseId, lessonId, seconds, endpoint, initialCompleted, messages.overviewDesign.previewSaveError, router]);
  useEffect(() => {
    if (endedRequest > handledEnd.current) { handledEnd.current = endedRequest; void complete(); }
  }, [endedRequest, complete]);
  const showBar = visible && !dismissed;
  return <>{showBar && <section className={styles.bar} aria-label={copy.label}>
    <div className={styles.badge} aria-hidden="true">{percent}%</div>
    <div className={styles.copy}><p>{copy.watched.replace("{number}", lessonNumber).replace("{percent}", percent)}</p><h2>{completed ? messages.learning.completed : copy.question}</h2>{error && <p className={styles.error} role="alert">{error}</p>}</div>
    <button type="button" className={styles.keep} disabled={busy} onClick={() => setDismissed(true)}>{copy.keepWatching}</button>
    <button type="button" className={styles.complete} disabled={busy} onClick={() => void complete()}>{busy ? messages.learning.processing : copy.complete}</button>
  </section>}{!showBar && error && <div role="alert"><p>{error}</p><button type="button" className={styles.complete} disabled={busy} onClick={() => void complete()}>{busy ? messages.learning.processing : copy.complete}</button></div>}{dialogOpen && <LessonCompletedDialog locale={locale} lessonNumber={lessonNumber} onClose={() => setDialogOpen(false)} onContinue={() => { setDialogOpen(false); router.push(nextHref || `/${locale}/account/my-learning`); }}/>}</>;
}

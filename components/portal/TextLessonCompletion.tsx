"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { completeLessonOutline } from "@/lib/completeLessonOutline";
import { createClientEventId } from "@/lib/clientEventId";
import { LessonCompletedDialog } from "./LessonCompletedDialog";
import styles from "./text-lesson-completion.module.css";

export function TextLessonCompletion({ locale, courseId, lessonId, lessonNumber, lessonTitle, initialCompleted, nextHref, visible = true, endpoint = "/api/study/events" }: {
  locale: Locale; courseId: string; lessonId: string; lessonNumber: string; lessonTitle: string;
  initialCompleted: boolean; nextHref: string | null; visible?: boolean;
  endpoint?: "/api/study/events" | "/api/study/preview";
}) {
  const router = useRouter(), messages = getMessages(locale);
  const [completed, setCompleted] = useState(initialCompleted), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const request = useRef<string | null>(null), inFlight = useRef(false), saved = useRef(false);
  async function complete() {
    if (inFlight.current) return;
    if (saved.current) { setDialogOpen(true); return; }
    inFlight.current = true; setBusy(true); setError("");
    request.current ||= createClientEventId();
    try {
      await completeLessonOutline(endpoint, courseId, lessonId, "text", request.current);
      saved.current = true; setCompleted(true); setDialogOpen(true);
    } catch { setError(messages.overviewDesign.previewSaveError); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (!visible) return null;
  return <div className={styles.row}>
    {completed && <span className={styles.completed} role="status" aria-label={messages.videoCompletion.label}>100% · {messages.learning.completed}</span>}
    <button type="button" className={styles.next} disabled={busy} onClick={() => void complete()}>{busy ? messages.learning.processing : messages.learning.nextLesson}</button>
    {error && <p role="alert">{error}</p>}
    {dialogOpen && <LessonCompletedDialog locale={locale} courseId={courseId} lessonId={lessonId} lessonNumber={lessonNumber} lessonTitle={lessonTitle} onClose={() => setDialogOpen(false)} onContinue={() => { setDialogOpen(false); router.push(nextHref || `/${locale}/account/my-learning`); }}/>}
  </div>;
}

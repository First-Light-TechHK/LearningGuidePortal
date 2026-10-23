"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AssessmentAvailability } from "@/contracts/lesson-resources";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { completeLessonOutline } from "@/lib/completeLessonOutline";
import { createClientEventId } from "@/lib/clientEventId";
import { LessonCompletedDialog } from "./LessonCompletedDialog";
import styles from "./text-lesson-completion.module.css";

export function TextLessonCompletion({ locale, courseId, lessonId, lessonNumber, lessonTitle, nextHref, assessmentAvailability, visible = true, endpoint = "/api/study/events" }: {
  assessmentAvailability?: AssessmentAvailability;
  locale: Locale; courseId: string; lessonId: string; lessonNumber: string; lessonTitle: string;
  nextHref: string | null; visible?: boolean;
  endpoint?: "/api/study/events" | "/api/study/preview";
}) {
  const router = useRouter(), messages = getMessages(locale);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const request = useRef<string | null>(null), inFlight = useRef(false), saved = useRef(false);
  async function complete() {
    if (inFlight.current) return;
    if (saved.current) { setDialogOpen(true); return; }
    inFlight.current = true; setBusy(true); setError("");
    request.current ||= createClientEventId();
    try {
      await completeLessonOutline(endpoint, courseId, lessonId, "text", request.current);
      saved.current = true; setDialogOpen(true);
    } catch { setError(messages.overviewDesign.previewSaveError); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (!visible) return null;
  return <div className={styles.row}>
    <button type="button" className={styles.next} disabled={busy} onClick={() => void complete()}>{busy ? messages.learning.processing : messages.learning.nextLesson}</button>
    {error && <p role="alert">{error}</p>}
    {dialogOpen && <LessonCompletedDialog assessmentAvailability={assessmentAvailability} locale={locale} courseId={courseId} lessonId={lessonId} lessonNumber={lessonNumber} lessonTitle={lessonTitle} onClose={() => setDialogOpen(false)} onContinue={() => { setDialogOpen(false); router.push(nextHref || `/${locale}/account/my-learning`); }}/>}
  </div>;
}

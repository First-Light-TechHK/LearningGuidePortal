"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpenCheck, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import type { AssessmentAvailability } from "@/contracts/lesson-resources";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { completeLessonOutline } from "@/lib/completeLessonOutline";
import { createClientEventId } from "@/lib/clientEventId";
import { LessonCompletedDialog } from "./LessonCompletedDialog";
import styles from "./text-lesson-completion.module.css";

export function TextLessonCompletion({ locale, courseId, lessonId, lessonNumber, lessonTitle, nextHref, variant = "row", assessmentAvailability, visible = true, endpoint = "/api/study/events" }: {
  assessmentAvailability?: AssessmentAvailability;
  locale: Locale; courseId: string; lessonId: string; lessonNumber: string; lessonTitle: string;
  nextHref: string | null; visible?: boolean;
  variant?: "row" | "card";
  endpoint?: "/api/study/events" | "/api/study/preview";
}) {
  const router = useRouter(), messages = getMessages(locale);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const isAtEnd = useRef(false);
  const copy = messages.learning.textLessonEnd;
  const lastLesson = nextHref === null;
  useEffect(() => {
    if (!visible || variant !== "card" || !card.current) return;
    const surface = card.current.parentElement;
    const trigger = surface?.querySelector("[data-text-completion-trigger]");
    if (!surface || !trigger) return;
    // Observe the end marker in normal flow, never the floating action itself.
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        isAtEnd.current = entry.isIntersecting;
        setAtEnd(entry.isIntersecting);
        if (entry.isIntersecting) setRevealed(true);
      }
    }, { threshold: 1 });
    observer.observe(trigger);
    const reserveSpace = () => {
      const height = `${Math.ceil(card.current!.getBoundingClientRect().height) + 24}px`;
      if (surface.style.getPropertyValue("--text-completion-height") === height) return;
      surface.style.setProperty("--text-completion-height", height);
      // Keep retries reachable if a translated error makes the floating bar taller.
      if (isAtEnd.current) trigger.scrollIntoView({ block: "nearest" });
    };
    const resize = new ResizeObserver(reserveSpace);
    resize.observe(card.current);
    reserveSpace();
    return () => { observer.disconnect(); resize.disconnect(); surface.style.removeProperty("--text-completion-height"); };
  }, [visible, variant]);
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
  return <div ref={card} className={variant === "card" ? styles.card : styles.row} data-text-completion data-revealed={revealed} data-at-end={atEnd} inert={variant === "card" && !atEnd ? true : undefined}>
    {variant === "card" && <><span className={styles.icon} aria-hidden="true"><BookOpenCheck size={18}/></span><div className={styles.copy}><h2>{copy.title}</h2></div></>}
    <button type="button" className={variant === "card" ? styles.primary : styles.next} disabled={busy} aria-busy={busy} onClick={() => void complete()}>{variant === "card" ? <>{busy ? messages.learning.processing : lastLesson ? copy.finish : copy.continue}{busy ? <LoaderCircle className={styles.spinner} size={15} aria-hidden="true"/> : <ArrowRight size={15} aria-hidden="true"/>}</> : busy ? messages.learning.processing : messages.learning.nextLesson}</button>
    {error && <p role="alert">{error}</p>}
    {dialogOpen && <LessonCompletedDialog isLastLesson={nextHref === null} assessmentAvailability={assessmentAvailability} locale={locale} courseId={courseId} lessonId={lessonId} lessonNumber={lessonNumber} lessonTitle={lessonTitle} onClose={() => setDialogOpen(false)} onContinue={() => { setDialogOpen(false); router.push(nextHref || `/${locale}/account/my-learning`); }}/>}
  </div>;
}

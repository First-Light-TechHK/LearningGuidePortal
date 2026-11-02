"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import type { AssessmentAvailability } from "@/contracts/lesson-resources";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { completeLessonOutline } from "@/lib/completeLessonOutline";
import { createClientEventId } from "@/lib/clientEventId";
import { LessonCompletedDialog } from "./LessonCompletedDialog";
import styles from "./text-lesson-completion.module.css";

export function TextLessonCompletion({ locale, courseId, lessonId, lessonNumber, lessonTitle, nextLesson, nextHref, variant = "row", assessmentAvailability, visible = true, endpoint = "/api/study/events" }: {
  assessmentAvailability?: AssessmentAvailability;
  nextLesson?: { number: string; title: string };
  locale: Locale; courseId: string; lessonId: string; lessonNumber: string; lessonTitle: string;
  nextHref: string | null; visible?: boolean;
  variant?: "row" | "card";
  endpoint?: "/api/study/events" | "/api/study/preview";
}) {
  const router = useRouter(), messages = getMessages(locale);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const isAtEnd = useRef(false);
  const [atEnd, setAtEnd] = useState(false);
  const [onSurface, setOnSurface] = useState(false);
  useEffect(() => {
    if (!visible || variant !== "card" || !card.current) return;
    const surface = card.current.parentElement;
    const trigger = surface?.querySelector("[data-text-completion-trigger]");
    if (!surface || !trigger) return;
    // Reaching the end also restores full opacity on the fixed action.
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        isAtEnd.current = entry.isIntersecting;
        setAtEnd(entry.isIntersecting);
      }
    }, { threshold: 1 });
    observer.observe(trigger);
    const reader = surface.querySelector<HTMLElement>("[data-text-reader]");
    let frame = 0;
    const position = () => {
      frame = 0;
      if (!reader) return;
      const bounds = reader.getBoundingClientRect();
      surface.style.setProperty("--completion-center", `${bounds.left + bounds.width / 2}px`);
      surface.style.setProperty("--completion-max-width", `${Math.max(0, Math.min(bounds.width - 24, window.innerWidth - 24))}px`);
      setOnSurface(bounds.top < window.innerHeight && bounds.bottom > 0);
    };
    const schedulePosition = () => { if (!frame) frame = requestAnimationFrame(position); };
    const reserveSpace = () => {
      const height = `${Math.ceil(card.current!.getBoundingClientRect().height) + 24}px`;
      if (surface.style.getPropertyValue("--text-completion-height") === height) return;
      surface.style.setProperty("--text-completion-height", height);
      // Keep retries reachable if a translated error makes the floating bar taller.
      if (isAtEnd.current) trigger.scrollIntoView({ block: "nearest" });
    };
    const resize = new ResizeObserver(() => { reserveSpace(); schedulePosition(); });
    resize.observe(card.current);
    if (reader) resize.observe(reader);
    resize.observe(surface);
    reserveSpace(); position();
    window.addEventListener("scroll", schedulePosition, { passive: true });
    window.addEventListener("resize", schedulePosition);
    window.visualViewport?.addEventListener("resize", schedulePosition);
    return () => {
      observer.disconnect(); resize.disconnect(); cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedulePosition);
      window.removeEventListener("resize", schedulePosition);
      window.visualViewport?.removeEventListener("resize", schedulePosition);
      for (const property of ["--text-completion-height", "--completion-center", "--completion-max-width"]) surface.style.removeProperty(property);
    };
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
  return <><div ref={card} className={variant === "card" ? styles.card : styles.row} data-text-completion data-at-end={atEnd} data-on-surface={onSurface} inert={variant === "card" && !onSurface ? true : undefined}>
    <button type="button" className={variant === "card" ? styles.primary : styles.next} disabled={busy} aria-busy={busy} onClick={() => void complete()}>{variant === "card" ? <>{busy ? messages.learning.processing : messages.learning.nextLesson}{busy ? <LoaderCircle className={styles.spinner} size={15} aria-hidden="true"/> : <ArrowRight size={15} aria-hidden="true"/>}</> : busy ? messages.learning.processing : messages.learning.nextLesson}</button>
    {error && <p role="alert">{error}</p>}
  </div>
    {dialogOpen && <LessonCompletedDialog nextLesson={nextLesson} isLastLesson={nextHref === null} assessmentAvailability={assessmentAvailability} locale={locale} courseId={courseId} lessonId={lessonId} lessonNumber={lessonNumber} lessonTitle={lessonTitle} onClose={() => setDialogOpen(false)} onContinue={() => { setDialogOpen(false); router.push(nextHref || `/${locale}/account/my-learning`); }}/>}
  </>;
}

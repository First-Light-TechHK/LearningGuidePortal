"use client";

import Image from "next/image";
import { useId, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { CourseLearningMode } from "@/contracts/course-learning-mode";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { PortalDialog } from "./PortalDialog";
import styles from "./course-learning-mode.module.css";

export function CourseLearningModeDialog({ courseId, locale, signedIn, pendingMode = null, destinationHref }: {
  courseId: string; locale: Locale; signedIn: boolean; pendingMode?: CourseLearningMode | null; destinationHref?: string;
}) {
  const copy = getMessages(locale).courseLearningMode;
  const router = useRouter(), pathname = usePathname(), titleId = useId(), descriptionId = useId(), groupName = useId();
  const [open, setOpen] = useState(true), [mode, setMode] = useState<CourseLearningMode | null>(pendingMode);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  function removePendingMode() {
    const url = new URL(window.location.href);
    if (url.searchParams.has("learningMode") || url.searchParams.has("lessonEntry")) {
      url.searchParams.delete("learningMode");
      url.searchParams.delete("lessonEntry");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
  }
  function close() { if (!busy) { setOpen(false); removePendingMode(); } }
  async function proceed() {
    if (!mode || busy) return;
    setError("");
    if (!signedIn) {
      const destination = new URL(window.location.href);
      destination.searchParams.set("learningMode", mode);
      router.push(`/${locale}/portal/sign-in?returnTo=${encodeURIComponent(pathname + destination.search + destination.hash)}`);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/learning-mode`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error("save");
      removePendingMode();
      setOpen(false);
      if (destinationHref) {
        const destination = new URL(destinationHref, window.location.origin);
        destination.searchParams.set("viewMode", mode);
        router.push(destination.pathname + destination.search);
      } else router.refresh();
    } catch { setError(copy.saveError); } finally { setBusy(false); }
  }
  if (!open) return null;
  return <PortalDialog className={styles.dialog} labelledBy={titleId} describedBy={descriptionId} onClose={close} busy={busy}>
    <button type="button" className={styles.close} aria-label={copy.close} disabled={busy} onClick={close}><Image src="/portal/learning-mode/close.svg" alt="" width={20} height={20}/></button>
    <h2 id={titleId}>{copy.title}</h2>
    <p id={descriptionId} className={styles.description}>{copy.description}</p>
    <fieldset className={styles.choices} disabled={busy}>
      <legend className={styles.srOnly}>{copy.title}</legend>
      {(["video", "text"] as const).map(value => <label key={value} className={`${styles.choice} ${mode === value ? styles.selected : ""}`}>
        <input type="radio" name={groupName} value={value} checked={mode === value} onChange={() => { setMode(value); setError(""); }}/>
        <Image src={`/portal/learning-mode/${value}.svg`} alt="" width={40} height={40}/>
        <span>{value === "video" ? copy.video : copy.text}</span>
      </label>)}
    </fieldset>
    <p className={styles.note}>{copy.savedNote}</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <button type="button" className={`portal-button portal-button-primary ${styles.continue}`} disabled={!mode || busy} onClick={() => void proceed()}>{busy ? copy.saving : mode === "video" ? copy.continueVideo : mode === "text" ? copy.continueText : copy.continue}</button>
  </PortalDialog>;
}

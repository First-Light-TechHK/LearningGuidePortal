"use client";

import { PortalProvider } from "./ui/PortalProvider";

import { PortalButton } from "./ui/PortalButton";

import Image from "next/image";
import { useId, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { CourseLearningMode, CourseLearningModeContext, CourseLearningModeResult } from "@/contracts/course-learning-mode";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { PortalDialog } from "./PortalDialog";
import styles from "./course-learning-mode.module.css";

export function CourseLearningModeDialog(props: Parameters<typeof CourseLearningModeDialogContent>[0]) {
  return <PortalProvider locale={props.locale}><CourseLearningModeDialogContent {...props}/></PortalProvider>;
}

function CourseLearningModeDialogContent({ courseId, locale, signedIn, pendingMode = null, destinationHref, accessContext = "preview" }: {
  courseId: string; locale: Locale; signedIn: boolean; pendingMode?: CourseLearningMode | null; destinationHref?: string; accessContext?: CourseLearningModeContext;
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
      const destination = destinationHref ? new URL(destinationHref, window.location.origin) : null;
      const lessonId = destination?.searchParams.get("lessonId");
      const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/learning-mode`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, accessContext, ...(lessonId ? { lessonId, intent: "entry" } : {}) }) });
      const result = await response.json() as { ok?: boolean; code?: string; data?: CourseLearningModeResult };
      if (response.status === 409 && result.code === "access_changed") { router.refresh(); return; }
      if (!response.ok || !result.ok) throw new Error("save");
      if (lessonId && !result.data?.position) throw new Error("entry-unavailable");
      removePendingMode();
      setOpen(false);
      if (destination) {
        if (result.data?.position) {
          destination.searchParams.set("lessonId", result.data.position.lessonId);
          destination.searchParams.delete("contentId");
          if (result.data.position.contentId) destination.searchParams.set("contentId", result.data.position.contentId);
        }
        destination.searchParams.set("viewMode", mode);
        destination.searchParams.set("modeSwitch", "1");
        if (mode === "video") destination.searchParams.set("autoplay", "1");
        // Read the newly saved preference on a fresh request, bypassing prefetched chooser redirects.
        window.location.assign(destination.pathname + destination.search);
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
    <PortalButton type="primary" className={styles.continue} loading={busy} disabled={!mode || busy} onClick={() => void proceed()}>{busy ? copy.saving : mode === "video" ? copy.continueVideo : mode === "text" ? copy.continueText : copy.continue}</PortalButton>
  </PortalDialog>;
}

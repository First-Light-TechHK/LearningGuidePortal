"use client";

import { useEffect, useRef, useState } from "react";
import type { CourseLearningMode } from "@/contracts/course-learning-mode";
import { useRouter } from "next/navigation";

export function PreviewProgress({ courseId, lessonId, contentId, learningMode, seconds, initialCompleted, copy, canComplete = true, enabled = true, showError = true, endpoint = "/api/study/preview" }: {
  courseId: string; lessonId: string; seconds: number; initialCompleted: boolean;
  contentId?: string | null; learningMode?: CourseLearningMode;
  copy: { completeLesson: string; completed: string; saveError: string };
  canComplete?: boolean;
  enabled?: boolean;
  showError?: boolean;
  endpoint?: "/api/study/preview" | "/api/study/events";
}) {
  const router = useRouter();
  const [completed, setCompleted] = useState(initialCompleted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const openRequest = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const key = `${courseId}:${lessonId}:${learningMode || ""}:${contentId || ""}`;
    if (openRequest.current?.key !== key) openRequest.current = { key, id: learningMode ? `open_${Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join("_")}` : `open_${courseId}_${lessonId}` };
    fetch(endpoint, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId, lessonId, ...(learningMode ? {contentId:contentId || null,learningMode} : {}), event: "open", seconds:0, clientEventId:openRequest.current.id }) })
      .then(response => { if (!response.ok) setError(copy.saveError); })
      .catch(error => { if (error.name !== "AbortError") setError(copy.saveError); });
  }, [courseId, lessonId, contentId, learningMode, copy.saveError, endpoint, enabled]);


  async function complete() {
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId, lessonId, ...(learningMode ? {contentId:contentId || null,learningMode} : {}), event: "complete", seconds, clientEventId:`complete_${courseId}_${lessonId}_${contentId || "legacy"}` }) });
      if (!response.ok) throw new Error(copy.saveError);
      setCompleted(true); router.refresh();
    } catch { setError(copy.saveError); }
    finally { setBusy(false); }
  }
  if (!canComplete && !showError) return null;
  return <div className="preview-progress">{canComplete && <button type="button" className="portal-button portal-button-primary" disabled={completed || busy} onClick={complete}>{completed ? copy.completed : copy.completeLesson}</button>}{showError && error ? <p role="alert" className="portal-form-error">{error}</p> : null}</div>;
}

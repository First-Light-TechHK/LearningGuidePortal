"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function PreviewProgress({ courseId, lessonId, seconds, initialCompleted, copy }: {
  courseId: string; lessonId: string; seconds: number; initialCompleted: boolean;
  copy: { completeLesson: string; completed: string; saveError: string };
}) {
  const router = useRouter();
  const [completed, setCompleted] = useState(initialCompleted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/study/preview", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId, lessonId, event: "open" }) })
      .then(response => { if (!response.ok) setError(copy.saveError); })
      .catch(error => { if (error.name !== "AbortError") setError(copy.saveError); });
    return () => controller.abort();
  }, [courseId, lessonId, copy.saveError]);

  async function complete() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/study/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId, lessonId, event: "complete", seconds }) });
      if (!response.ok) throw new Error(copy.saveError);
      setCompleted(true); router.refresh();
    } catch { setError(copy.saveError); }
    finally { setBusy(false); }
  }
  return <div className="preview-progress"><button type="button" className="portal-button portal-button-primary" disabled={completed || busy} onClick={complete}>{completed ? copy.completed : copy.completeLesson}</button>{error ? <p role="alert" className="portal-form-error">{error}</p> : null}</div>;
}

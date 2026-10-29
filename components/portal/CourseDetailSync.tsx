"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { CourseEntrySnapshot, CoursePageResponse } from "@/contracts/course-page";

/** Reconcile history-restored course actions with the current server Study record. */
export function CourseDetailSync({ slug, snapshot }: { slug: string; snapshot: CourseEntrySnapshot }) {
  const router = useRouter();
  const { pageState, cta, actionLessonId, progress, openedLearningPointCount } = snapshot;
  useEffect(() => {
    let controller: AbortController | undefined, refreshRequested = false;
    const check = async () => {
      controller?.abort();
      const request = controller = new AbortController();
      try {
        const response = await fetch(`/api/portal/courses/${encodeURIComponent(slug)}`, { cache: "no-store", credentials: "same-origin", signal: request.signal });
        if (!response.ok || request.signal.aborted) return;
        const result = await response.json() as CoursePageResponse;
        const current = result.page;
        if (!result.ok || !current || request.signal.aborted || refreshRequested) return;
        if (!["available", "withdrawn", "failed"].includes(current.pageState)
          || ![null, "start_preview", "continue_preview", "view_plans", "continue_learning"].includes(current.cta)
          || !(current.actionLessonId === null || typeof current.actionLessonId === "string")
          || !(current.progress === null || typeof current.progress === "number" && Number.isFinite(current.progress))
          || typeof current.openedLearningPointCount !== "number") return;
        if (current.pageState !== pageState || current.cta !== cta || current.actionLessonId !== actionLessonId
          || current.progress !== progress || current.openedLearningPointCount !== openedLearningPointCount) {
          refreshRequested = true;
          router.refresh();
        }
      } catch { /* Keep the current server render on transient failures. */ }
    };
    void check();
    const onRestore = (event: PageTransitionEvent) => { if (event.persisted) void check(); };
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("pageshow", onRestore);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller?.abort();
      window.removeEventListener("pageshow", onRestore);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [slug, pageState, cta, actionLessonId, progress, openedLearningPointCount, router]);
  return null;
}

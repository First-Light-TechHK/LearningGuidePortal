"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { CourseEntrySnapshot, CoursePageResponse } from "@/contracts/course-page";

/** Reconcile history-restored course actions with the current server Study record. */
export function CourseDetailSync({ slug, snapshot }: { slug: string; snapshot: CourseEntrySnapshot }) {
  const router = useRouter();
  const { pageState, cta, actionLessonId, progress, openedLearningPointCount, bookmarkRevision = 0 } = snapshot;
  const continuationKey = JSON.stringify([...(snapshot.continuableLessonIds || [])].sort());
  const completionKey = JSON.stringify([...(snapshot.completedLessonIds || [])].sort());
  useEffect(() => {
    let controller: AbortController | undefined, refreshRequested = false;
    const coursePath = window.location.pathname;
    const retries = new Set<ReturnType<typeof setTimeout>>();
    const check = async () => {
      if (window.location.pathname !== coursePath) return;
      controller?.abort();
      const request = controller = new AbortController();
      try {
        const response = await fetch(`/api/portal/courses/${encodeURIComponent(slug)}`, { cache: "no-store", credentials: "same-origin", signal: request.signal });
        if (!response.ok || request.signal.aborted || window.location.pathname !== coursePath) return;
        const result = await response.json() as CoursePageResponse;
        const current = result.page;
        if (!result.ok || !current || request.signal.aborted || refreshRequested) return;
        if (!["available", "withdrawn", "failed"].includes(current.pageState)
          || ![null, "start_preview", "continue_preview", "view_plans", "continue_learning"].includes(current.cta)
          || !(current.actionLessonId === null || typeof current.actionLessonId === "string")
          || !(current.progress === null || typeof current.progress === "number" && Number.isFinite(current.progress))
          || typeof current.openedLearningPointCount !== "number"
          || !(current.bookmarkRevision === undefined || typeof current.bookmarkRevision === "number" && Number.isFinite(current.bookmarkRevision) && current.bookmarkRevision >= 0)) return;
        if (current.pageState !== pageState || current.cta !== cta || current.actionLessonId !== actionLessonId
          || current.progress !== progress || current.openedLearningPointCount !== openedLearningPointCount
          || (current.bookmarkRevision ?? 0) !== bookmarkRevision
          || JSON.stringify((current.syllabus || []).filter(lesson => lesson.continuable).map(lesson => lesson.lessonId).sort()) !== continuationKey
          || JSON.stringify((current.syllabus || []).filter(lesson => lesson.completed).map(lesson => lesson.lessonId).sort()) !== completionKey) {
          refreshRequested = true;
          router.refresh();
        }
      } catch { /* Keep the current server render on transient failures. */ }
    };
    const restore = () => {
      for (const timer of retries) clearTimeout(timer);
      retries.clear();
      void check();
      // A keepalive bookmark save from the departing Lesson can finish after the first read.
      for (const delay of [300, 1200]) {
        const timer = setTimeout(() => { retries.delete(timer); if (!refreshRequested) void check(); }, delay);
        retries.add(timer);
      }
    };
    restore();
    const onRestore = (event: PageTransitionEvent) => { if (event.persisted) restore(); };
    const onVisible = () => { if (document.visibilityState === "visible") restore(); };
    window.addEventListener("pageshow", onRestore);
    window.addEventListener("popstate", restore);
    window.addEventListener("focus", restore);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller?.abort();
      for (const timer of retries) clearTimeout(timer);
      window.removeEventListener("pageshow", onRestore);
      window.removeEventListener("popstate", restore);
      window.removeEventListener("focus", restore);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [slug, pageState, cta, actionLessonId, progress, openedLearningPointCount, bookmarkRevision, continuationKey, completionKey, router]);
  return null;
}

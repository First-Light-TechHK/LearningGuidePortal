"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { CourseEntrySnapshot, CoursePageResponse } from "@/contracts/course-page";
import { isCourseLearningMode } from "@/contracts/course-learning-mode";

/** Reconcile history-restored course actions with the current server Study record. */
export function CourseDetailSync({ slug, snapshot }: { slug: string; snapshot: CourseEntrySnapshot }) {
  const router = useRouter();
  const { pageState, cta, actionLessonId, progress, openedLearningPointCount, bookmarkRevision = 0, preferredMode = null } = snapshot;
  const continuationKey = JSON.stringify([...(snapshot.continuableLessonIds || [])].sort());
  const completionKey = JSON.stringify([...(snapshot.completedLessonIds || [])].sort());
  useEffect(() => {
    let controller: AbortController | undefined, refreshRequested = false, disposed = false, pending = false;
    let restoreTimer: ReturnType<typeof setTimeout> | undefined;
    const coursePath = window.location.pathname;
    const retries = new Set<ReturnType<typeof setTimeout>>();
    const clearTimers = () => {
      clearTimeout(restoreTimer);
      restoreTimer = undefined;
      for (const timer of retries) clearTimeout(timer);
      retries.clear();
    };
    const active = () => !disposed && !refreshRequested && window.location.pathname === coursePath;
    const check = async () => {
      if (!active()) return;
      // A slow read must finish; coalesce any newer demand into one trailing read.
      if (controller) { pending = true; return; }
      const request = controller = new AbortController();
      try {
        const response = await fetch(`/api/portal/courses/${encodeURIComponent(slug)}`, { cache: "no-store", credentials: "same-origin", signal: request.signal });
        if (!response.ok || request.signal.aborted || !active()) return;
        const result = await response.json() as CoursePageResponse;
        const current = result.page;
        if (!result.ok || !current || request.signal.aborted || !active()) return;
        if (!["available", "withdrawn", "failed"].includes(current.pageState)
          || ![null, "start_preview", "continue_preview", "view_plans", "continue_learning"].includes(current.cta)
          || !(current.actionLessonId === null || typeof current.actionLessonId === "string")
          || !(current.progress === null || typeof current.progress === "number" && Number.isFinite(current.progress))
          || typeof current.openedLearningPointCount !== "number"
          || (current.preferredMode != null && !isCourseLearningMode(current.preferredMode))
          || !(current.bookmarkRevision === undefined || typeof current.bookmarkRevision === "number" && Number.isFinite(current.bookmarkRevision) && current.bookmarkRevision >= 0)) return;
        if (current.pageState !== pageState || current.cta !== cta || current.actionLessonId !== actionLessonId
          || current.progress !== progress || current.openedLearningPointCount !== openedLearningPointCount
          || (current.bookmarkRevision ?? 0) !== bookmarkRevision
          || (current.preferredMode ?? null) !== preferredMode
          || JSON.stringify((current.syllabus || []).filter(lesson => lesson.continuable).map(lesson => lesson.lessonId).sort()) !== continuationKey
          || JSON.stringify((current.syllabus || []).filter(lesson => lesson.completed).map(lesson => lesson.lessonId).sort()) !== completionKey) {
          refreshRequested = true;
          pending = false;
          clearTimers();
          router.refresh();
        }
      } catch { /* Keep the current server render on transient failures. */ }
      finally {
        controller = undefined;
        if (pending && active()) { pending = false; void check(); }
      }
    };
    const leave = () => { pending = false; clearTimers(); controller?.abort(); };
    const restore = () => {
      if (window.location.pathname !== coursePath) { leave(); return; }
      if (!active()) return;
      // Tab restoration often emits both visibilitychange and focus.
      clearTimeout(restoreTimer);
      restoreTimer = setTimeout(() => {
        restoreTimer = undefined;
        for (const timer of retries) clearTimeout(timer);
        retries.clear();
        void check();
        // A departing Lesson's keepalive bookmark save may finish after the first read.
        for (const delay of [300, 1200]) {
          const timer = setTimeout(() => { retries.delete(timer); void check(); }, delay);
          retries.add(timer);
        }
      }, 75);
    };
    // Initial entry needs one validation, without restoration's delayed rechecks.
    void check();
    const onRestore = (event: PageTransitionEvent) => { if (event.persisted) restore(); };
    const onVisible = () => { if (document.visibilityState === "visible") restore(); };
    window.addEventListener("pageshow", onRestore);
    window.addEventListener("pagehide", leave);
    window.addEventListener("popstate", restore);
    window.addEventListener("focus", restore);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      leave();
      window.removeEventListener("pageshow", onRestore);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("popstate", restore);
      window.removeEventListener("focus", restore);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [slug, pageState, cta, actionLessonId, progress, openedLearningPointCount, bookmarkRevision, preferredMode, continuationKey, completionKey, router]);
  return null;
}

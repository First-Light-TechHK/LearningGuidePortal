"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isCourseLearningMode, type CourseModeSnapshot } from "@/contracts/course-learning-mode";

const modeKey = (courses: CourseModeSnapshot[]) => JSON.stringify([...courses].sort((a, b) => a.courseId.localeCompare(b.courseId)).map(course => [
  course.courseId, course.mode, course.currentLessonId ?? null, course.currentContentId ?? null,
  course.preferredMode ?? null,
  course.progress ?? null, course.updatedAt ?? null,
  course.bookmarkRevision ?? 0, [...(course.completedLessonIds || [])].sort(),
]));

/** Reconcile cached cards after study in another lesson, mode or browser tab. */
export function OverviewModeSync({ userId, courses }: { userId: string; courses: CourseModeSnapshot[] }) {
  const router = useRouter(), snapshot = modeKey(courses);
  useEffect(() => {
    let controller: AbortController | undefined, requested = false, disposed = false, pending = false;
    let restoreTimer: ReturnType<typeof setTimeout> | undefined;
    const overviewPath = window.location.pathname;
    const retries = new Set<ReturnType<typeof setTimeout>>();
    const clearTimers = () => {
      clearTimeout(restoreTimer);
      restoreTimer = undefined;
      for (const timer of retries) clearTimeout(timer);
      retries.clear();
    };
    const active = () => !disposed && !requested && window.location.pathname === overviewPath;
    const refresh = () => {
      if (!active()) return;
      requested = true;
      pending = false;
      clearTimers();
      router.refresh();
    };
    const check = async () => {
      if (!active()) return;
      // Preserve the active read and merge newer demand into one trailing read.
      if (controller) { pending = true; return; }
      const request = controller = new AbortController();
      try {
        const response = await fetch("/api/my-learning/overview", { cache: "no-store", credentials: "same-origin", signal: request.signal });
        if (request.signal.aborted || !active()) return;
        if (response.status === 401) { refresh();return; }
        if (!response.ok) return;
        const result = await response.json() as { ok?: boolean; user?: { id?: string }; overview?: { courses?: Array<CourseModeSnapshot & { courseStatus: string }> } };
        if (!result.ok || request.signal.aborted || !active() || !result.user?.id || !Array.isArray(result.overview?.courses)) return;
        const current = result.overview.courses.filter(course => course.courseStatus === "published");
        if (!current.every(course => typeof course.courseId === "string" && isCourseLearningMode(course.mode)
          && (course.preferredMode == null || isCourseLearningMode(course.preferredMode))
          && [course.currentLessonId, course.currentContentId, course.updatedAt].every(value => value == null || typeof value === "string")
          && (course.bookmarkRevision == null || (Number.isSafeInteger(course.bookmarkRevision) && course.bookmarkRevision >= 0))
          && (course.completedLessonIds == null || (Array.isArray(course.completedLessonIds) && course.completedLessonIds.every(id => typeof id === "string")))
          && (course.progress == null || (typeof course.progress === "number" && Number.isFinite(course.progress) && course.progress >= 0 && course.progress <= 100)))) return;
        if (result.user.id !== userId || modeKey(current as CourseModeSnapshot[]) !== snapshot) refresh();
      } catch { /* Preserve existing cards on transient failures. */ }
      finally {
        controller = undefined;
        if (pending && active()) { pending = false; void check(); }
      }
    };
    const leave = () => { pending = false; clearTimers(); controller?.abort(); };
    const restore = () => {
      if (window.location.pathname !== overviewPath) { leave(); return; }
      if (!active()) return;
      // Visibility, focus and BFCache events may describe the same restoration.
      clearTimeout(restoreTimer);
      restoreTimer = setTimeout(() => {
        restoreTimer = undefined;
        for (const timer of retries) clearTimeout(timer);
        retries.clear();
        void check();
        // Retain bounded rechecks for the departing Lesson's late keepalive save.
        for (const delay of [300, 1200]) {
          const timer = setTimeout(() => { retries.delete(timer); void check(); }, delay);
          retries.add(timer);
        }
      }, 75);
    };
    // Ordinary entry validates once; only restoration needs delayed rechecks.
    void check();
    const pageshow = (event: PageTransitionEvent) => { if (event.persisted) restore(); };
    const visible = () => { if (document.visibilityState === "visible") restore(); };
    window.addEventListener("pageshow", pageshow);window.addEventListener("pagehide", leave);window.addEventListener("popstate", restore);window.addEventListener("focus", restore);document.addEventListener("visibilitychange", visible);
    return () => { disposed = true;leave();window.removeEventListener("pageshow", pageshow);window.removeEventListener("pagehide", leave);window.removeEventListener("popstate", restore);window.removeEventListener("focus", restore);document.removeEventListener("visibilitychange", visible); };
  }, [userId, snapshot, router]);
  return null;
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isCourseLearningMode, type CourseModeSnapshot } from "@/contracts/course-learning-mode";

const modeKey = (courses: CourseModeSnapshot[]) => JSON.stringify([...courses].sort((a, b) => a.courseId.localeCompare(b.courseId)).map(course => [
  course.courseId, course.mode, course.currentLessonId ?? null, course.currentContentId ?? null,
  course.progress ?? null, course.updatedAt ?? null,
]));

/** Reconcile cached cards after study in another lesson, mode or browser tab. */
export function OverviewModeSync({ userId, courses }: { userId: string; courses: CourseModeSnapshot[] }) {
  const router = useRouter(), snapshot = modeKey(courses);
  useEffect(() => {
    let controller: AbortController | undefined, requested = false;
    const overviewPath = window.location.pathname;
    const retries = new Set<ReturnType<typeof setTimeout>>();
    const refresh = () => { if (!requested) { requested = true;router.refresh(); } };
    const check = async () => {
      if (window.location.pathname !== overviewPath) return;
      controller?.abort();
      const request = controller = new AbortController();
      try {
        const response = await fetch("/api/my-learning/overview", { cache: "no-store", credentials: "same-origin", signal: request.signal });
        if (request.signal.aborted || window.location.pathname !== overviewPath) return;
        if (response.status === 401) { refresh();return; }
        if (!response.ok) return;
        const result = await response.json() as { ok?: boolean; user?: { id?: string }; overview?: { courses?: Array<CourseModeSnapshot & { courseStatus: string }> } };
        if (!result.ok || request.signal.aborted || !result.user?.id || !Array.isArray(result.overview?.courses)) return;
        const current = result.overview.courses.filter(course => course.courseStatus === "published");
        if (!current.every(course => typeof course.courseId === "string" && isCourseLearningMode(course.mode)
          && [course.currentLessonId, course.currentContentId, course.updatedAt].every(value => value == null || typeof value === "string")
          && (course.progress == null || (typeof course.progress === "number" && Number.isFinite(course.progress) && course.progress >= 0 && course.progress <= 100)))) return;
        if (result.user.id !== userId || modeKey(current as CourseModeSnapshot[]) !== snapshot) refresh();
      } catch { /* Preserve existing cards on transient failures. */ }
    };
    const restore = () => {
      for (const timer of retries) clearTimeout(timer);
      retries.clear();
      void check();
      for (const delay of [300, 1200]) {
        const timer = setTimeout(() => { retries.delete(timer); if (!requested) void check(); }, delay);
        retries.add(timer);
      }
    };
    restore();
    const pageshow = (event: PageTransitionEvent) => { if (event.persisted) restore(); };
    const visible = () => { if (document.visibilityState === "visible") restore(); };
    window.addEventListener("pageshow", pageshow);window.addEventListener("popstate", restore);window.addEventListener("focus", restore);document.addEventListener("visibilitychange", visible);
    return () => { controller?.abort();for (const timer of retries) clearTimeout(timer);window.removeEventListener("pageshow", pageshow);window.removeEventListener("popstate", restore);window.removeEventListener("focus", restore);document.removeEventListener("visibilitychange", visible); };
  }, [userId, snapshot, router]);
  return null;
}

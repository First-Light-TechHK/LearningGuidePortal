"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isCourseLearningMode, type CourseModeSnapshot } from "@/contracts/course-learning-mode";

const modeKey = (courses: CourseModeSnapshot[]) => JSON.stringify(courses.map(course => [course.courseId, course.mode]).sort((a, b) => a[0].localeCompare(b[0])));

/** Refresh history-restored My Learning cards after an explicit lesson-mode change. */
export function OverviewModeSync({ userId, courses }: { userId: string; courses: CourseModeSnapshot[] }) {
  const router = useRouter(), snapshot = modeKey(courses);
  useEffect(() => {
    let controller: AbortController | undefined, requested = false;
    const refresh = () => { if (!requested) { requested = true;router.refresh(); } };
    const check = async () => {
      controller?.abort();
      const request = controller = new AbortController();
      try {
        const response = await fetch("/api/my-learning/overview", { cache: "no-store", credentials: "same-origin", signal: request.signal });
        if (request.signal.aborted) return;
        if (response.status === 401) { refresh();return; }
        if (!response.ok) return;
        const result = await response.json() as { ok?: boolean; user?: { id?: string }; overview?: { courses?: Array<{ courseId: string; mode: string; courseStatus: string }> } };
        if (!result.ok || request.signal.aborted || !result.user?.id || !Array.isArray(result.overview?.courses)) return;
        const current = result.overview.courses.filter(course => course.courseStatus === "published");
        if (!current.every(course => typeof course.courseId === "string" && isCourseLearningMode(course.mode))) return;
        if (result.user.id !== userId || modeKey(current as CourseModeSnapshot[]) !== snapshot) refresh();
      } catch { /* Preserve existing cards on transient failures. */ }
    };
    void check();
    const restore = (event: PageTransitionEvent) => { if (event.persisted) void check(); };
    const visible = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("pageshow", restore);window.addEventListener("focus", check);document.addEventListener("visibilitychange", visible);
    return () => { controller?.abort();window.removeEventListener("pageshow", restore);window.removeEventListener("focus", check);document.removeEventListener("visibilitychange", visible); };
  }, [userId, snapshot, router]);
  return null;
}

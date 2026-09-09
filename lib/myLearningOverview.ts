export type OverviewCardState =
  | "previewing"
  | "preview_limit"
  | "learning"
  | "completed"
  | "no_access_history"
  | "withdrawn"
  | "progress_failed";

export type OverviewCta =
  | "continue_preview"
  | "view_plans"
  | "continue_learning"
  | "review_course"
  | "view_course"
  | "browse_courses"
  | null;

export type AccessState = "none" | "active" | "cancel_at_period_end" | "grace" | "expired";

export function uniqueOpenedLearningPointIds(events: Array<{ lessonId: string }>): string[] {
  return [...new Set(events.map((event) => event.lessonId).filter(Boolean))];
}

/** D2.1 ML-FR-007…010: progress is unique opened LPs, never seconds. */
export function courseProgressFromUniqueLearningPoints(openedCount: number, totalCount: number): {
  progress: number | null;
  progressFailed: boolean;
  completed: boolean;
} {
  if (!Number.isFinite(totalCount) || totalCount <= 0) {
    return { progress: null, progressFailed: true, completed: false };
  }
  const opened = Math.max(0, Math.min(Math.round(openedCount), totalCount));
  const progress = Math.min(100, Math.round((opened / totalCount) * 100));
  return { progress, progressFailed: false, completed: opened >= totalCount };
}

export function isSubscribedAccess(state: AccessState): boolean {
  return state === "active" || state === "cancel_at_period_end" || state === "grace";
}

/** D2.2 ML-FR-011: five bands from subscription facts after the expiry sweep. */
export function accessStateFromSubscriptions(subscriptions: Array<{ state: string }>): AccessState {
  const live = subscriptions.filter((item) => ["active", "cancel_at_period_end", "grace"].includes(item.state));
  if (live.some((item) => item.state === "grace")) return "grace";
  if (live.some((item) => item.state === "cancel_at_period_end")) return "cancel_at_period_end";
  if (live.some((item) => item.state === "active")) return "active";
  if (subscriptions.some((item) => item.state === "expired" || item.state === "trial_canceled")) return "expired";
  return "none";
}

/** D2.3 ML-FR-004/006/022: 试看中 until preview LPs are completed; then 达限. */
export function resolveOverviewCard(input: {
  courseStatus?: string;
  progressFailed: boolean;
  completed: boolean;
  hasLiveEntitlement: boolean;
  previewLessonIds: string[];
  openedLessonIds: string[];
  completedPreviewIds: string[];
  accessEnded: boolean;
}): { cardState: OverviewCardState; cta: OverviewCta } {
  if (input.progressFailed) return { cardState: "progress_failed", cta: "view_course" };
  if (input.courseStatus !== "published") return { cardState: "withdrawn", cta: null };
  if (input.hasLiveEntitlement) {
    if (input.completed) return { cardState: "completed", cta: "review_course" };
    return { cardState: "learning", cta: "continue_learning" };
  }
  if (input.accessEnded) return { cardState: "no_access_history", cta: "view_plans" };
  const previewRemaining = input.previewLessonIds.some((id) => !input.completedPreviewIds.includes(id));
  if (input.previewLessonIds.length > 0 && previewRemaining) {
    return { cardState: "previewing", cta: "continue_preview" };
  }
  if (input.previewLessonIds.length > 0 && input.openedLessonIds.some((id) => input.previewLessonIds.includes(id))) {
    return { cardState: "preview_limit", cta: "view_plans" };
  }
  return { cardState: "no_access_history", cta: "view_plans" };
}

export function overviewEmptyState(courseCount: number, accessState: AccessState): {
  emptyState: "no_preview" | "no_started" | null;
  emptyCta: "browse_courses" | null;
} {
  if (courseCount > 0) return { emptyState: null, emptyCta: null };
  return {
    emptyState: isSubscribedAccess(accessState) ? "no_started" : "no_preview",
    emptyCta: "browse_courses",
  };
}

import type { AssessmentSummary } from "./lesson-assessment";
/** current means accessible, not a learning-order prerequisite; locked is retained for response compatibility. */
export interface UnderstandingLessonDisplay { id: string; number: string; title: string; state: "completed" | "current" | "locked"; knowledge: AssessmentSummary; application: AssessmentSummary }
export interface UnderstandingOverviewDisplay {
  /** Completed / available tests across the Course; partial answers do not count. */
  completed: number; total: number; percent: number; lessons: UnderstandingLessonDisplay[];
}

import type { AssessmentSummary } from "./lesson-assessment";
export interface UnderstandingLessonDisplay { id: string; number: string; title: string; state: "completed" | "current" | "locked"; knowledge: AssessmentSummary; application: AssessmentSummary }
export interface UnderstandingOverviewDisplay {
  /** Every available test is accessible with current Course access, independently of Study/completion order. */
  /** Completed tests / two tests per published course Lesson; partial answers do not count. */
  completed: number; total: number; percent: number; lessons: UnderstandingLessonDisplay[];
}

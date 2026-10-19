import type { AssessmentSummary } from "./lesson-assessment";
export interface UnderstandingLessonDisplay { id: string; number: string; title: string; state: "completed" | "current" | "locked"; knowledge: AssessmentSummary; application: AssessmentSummary }
export interface UnderstandingOverviewDisplay {
  completed: number; total: number; percent: number; lessons: UnderstandingLessonDisplay[];
}

export interface UnderstandingLessonSample { number: string; title: string; state: "completed" | "current" | "locked" }
export interface UnderstandingOverviewDisplay {
  completed: number; total: number; percent: number; lessons: UnderstandingLessonSample[];
}

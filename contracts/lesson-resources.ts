import type { KnowledgeQuestion } from "./knowledge-test";
import type { ExplorationDisplay } from "./exploration";

/** Authored course content, not UI translations or learner assessment records. */
export type ApplicationQuestion = { id: string; paragraphs: string[]; reference: string[] };
export type LessonAssessments = { knowledge: KnowledgeQuestion[]; application: ApplicationQuestion | null };
export type LessonPreviewConfiguration = { textPointCount: number; videoLimitSeconds: number };
export type LessonResources = {
  preview?: LessonPreviewConfiguration;
  exploration?: ExplorationDisplay;
  assessments?: LessonAssessments;
};
export type AssessmentAvailability = { knowledge: number; application: boolean };

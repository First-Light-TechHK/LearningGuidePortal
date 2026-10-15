export interface ApplicationTestSample { id: string; paragraphs: string[]; strengths: string; improvement: string; reference: string[]; sampleAnswer: string }
export type ApplicationTestPhase = "answer" | "evaluating" | "result";
export type ApplicationTestEntrySource = "lesson" | "overview";
export interface ApplicationTestAttempt { answer: string; phase: ApplicationTestPhase; startedAt: number | null }
export const APPLICATION_TEST_ANSWER_LIMIT = 2000;
export const APPLICATION_TEST_EVALUATION_MS = 3000;

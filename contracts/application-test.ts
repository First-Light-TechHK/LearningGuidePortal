export interface ApplicationTestSample { id: string; paragraphs: string[]; strengths: string; improvement: string }
export type ApplicationTestPhase = "answer" | "evaluating" | "result";
export const APPLICATION_TEST_ANSWER_LIMIT = 2000;
export const APPLICATION_TEST_EVALUATION_MS = 3000;

import type { KnowledgeResponse } from "./knowledge-test";

export type AssessmentKind = "knowledge" | "application";
export type KnowledgeAttempt = { kind: "knowledge"; responses: KnowledgeResponse[]; index: number; phase: "question" | "answer" | "result" };
export type ApplicationAttempt = { kind: "application"; answer: string; phase: "answer" | "evaluating" | "submitted" };
export type AssessmentAttempt = KnowledgeAttempt | ApplicationAttempt;
export type SavedAssessment = { lessonId: string; kind: AssessmentKind; version: number; attempt: AssessmentAttempt; completedAt: string | null; updatedAt: string; evaluationStartedAt?: string | null };
export type AssessmentWrite = { clientEventId: string; expectedVersion: number; attempt: AssessmentAttempt };
export type AssessmentSummary = { status: "not_started" | "in_progress" | "completed" | "submitted"; answered: number; total: number; percent: number; score: number | null };
export class AssessmentError extends Error {
  constructor(public code: "ASSESSMENT_INVALID" | "ASSESSMENT_UNAUTHORISED" | "ASSESSMENT_FORBIDDEN" | "ASSESSMENT_NOT_FOUND" | "ASSESSMENT_CONFLICT" | "ASSESSMENT_UNAVAILABLE", public status = 400) { super(code); }
}

export function parseAssessmentWrite(value: unknown): AssessmentWrite {
  if (!value || typeof value !== "object") throw new AssessmentError("ASSESSMENT_INVALID");
  const input = value as Record<string, unknown>, attempt = input.attempt as Record<string, unknown> | undefined;
  if (typeof input.clientEventId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.clientEventId)
    || !Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 0 || !attempt) throw new AssessmentError("ASSESSMENT_INVALID");
  let parsed: AssessmentAttempt;
  if (attempt.kind === "knowledge") {
    if (!Array.isArray(attempt.responses) || attempt.responses.length > 100 || !Number.isInteger(attempt.index) || !["question", "answer", "result"].includes(String(attempt.phase))) throw new AssessmentError("ASSESSMENT_INVALID");
    const responses = attempt.responses.map(response => {
      if (!response || typeof response.answer !== "string" || response.answer.length > 2000 || ![null, "right", "wrong"].includes(response.rating)) throw new AssessmentError("ASSESSMENT_INVALID");
      return { answer: response.answer, rating: response.rating } as KnowledgeResponse;
    });
    parsed = { kind: "knowledge", responses, index: Number(attempt.index), phase: attempt.phase as KnowledgeAttempt["phase"] };
  } else if (attempt.kind === "application") {
    if (typeof attempt.answer !== "string" || attempt.answer.length > 2000 || !["answer", "evaluating", "submitted"].includes(String(attempt.phase)) || (attempt.phase !== "answer" && !attempt.answer.trim())) throw new AssessmentError("ASSESSMENT_INVALID");
    parsed = { kind: "application", answer: attempt.answer, phase: attempt.phase as ApplicationAttempt["phase"] };
  } else throw new AssessmentError("ASSESSMENT_INVALID");
  return { clientEventId: input.clientEventId, expectedVersion: Number(input.expectedVersion), attempt: parsed };
}

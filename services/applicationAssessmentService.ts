import { createHash, randomUUID } from "node:crypto";
import { AssessmentError, parseAssessmentWrite, type SavedAssessment } from "@/contracts/lesson-assessment";
import { assessmentContext, readAssessment } from "./lessonAssessmentService";
import { saveLessonAssessment } from "@/repositories/lessonAssessmentRepository";
import { evaluateApplication } from "./ksTutorClient";
import { getApplicationTestSample } from "./applicationTestSample";

export const APPLICATION_EVALUATION_LEASE_MS = 90000;
export async function submitApplicationAssessment(userId: string, courseId: string, lessonId: string, value: unknown) {
  const input = parseAssessmentWrite(value);
  if (input.attempt.kind !== "application" || input.attempt.phase !== "answer" || !input.attempt.answer.trim()) throw new AssessmentError("ASSESSMENT_INVALID");
  const locale = (value as { locale?: unknown }).locale;
  if (locale !== "en-GB" && locale !== "zh-CN") throw new AssessmentError("ASSESSMENT_INVALID");
  const { course } = await assessmentContext(userId, courseId);
  const requestHash = createHash("sha256").update(JSON.stringify([input.attempt.answer, locale])).digest("hex");
  const existing = await readAssessment(userId, course.id, lessonId, "application");
  if (existing?.evaluation?.eventId === input.clientEventId) {
    if (existing.evaluation.requestHash !== requestHash || existing.attempt.kind !== "application" || existing.attempt.answer !== input.attempt.answer) throw new AssessmentError("ASSESSMENT_CONFLICT", 409);
    if (existing.evaluation.status === "done") return existing;
  }
  if (existing?.evaluation?.status === "pending" && Date.now() - Date.parse(existing.evaluation.startedAt) < APPLICATION_EVALUATION_LEASE_MS) throw new AssessmentError("ASSESSMENT_CONFLICT", 409);
  const lesson = course.sections.flatMap(section => section.lessons).find(item => item.id === lessonId)!;
  const question = lesson.assessments?.application?.paragraphs || getApplicationTestSample(locale).paragraphs;
  const id = existing?.evaluation?.eventId === input.clientEventId ? existing.evaluation.id : randomUUID(), timestamp = new Date().toISOString();
  const submissions = existing?.submissions || (existing?.evaluation?.result ? [{id:existing.evaluation.id,answer:existing.evaluation.result.yourAnswer,submittedAt:existing.updatedAt,result:existing.evaluation.result}] : []);
  const claim: SavedAssessment = {
    ...existing, submissions: submissions.some(item=>item.id===id) ? submissions : [...submissions,{id,answer:input.attempt.answer,submittedAt:timestamp}], lessonId, kind: "application", version: input.expectedVersion + 1,
    attempt: { ...input.attempt, phase: "evaluating" }, updatedAt: timestamp,
    completedAt: existing?.completedAt || null,
    evaluation: { id, eventId: input.clientEventId, locale, requestHash, status: "pending", startedAt: timestamp },
  };
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const stored = await saveLessonAssessment(userId, course.id, lessonId, "application", input.expectedVersion, randomUUID(), hash, claim);
  try {
    const result = await evaluateApplication({ externalCourseId: course.slug, question: question.join("\n\n"), answer: input.attempt.answer, locale, userId, evaluationId: id });
    const finished: SavedAssessment = { ...stored, submissions: stored.submissions?.map(item => item.id === id ? {...item,result} : item), version: stored.version + 1, attempt: { ...input.attempt, phase: "submitted" },
      updatedAt: new Date().toISOString(), completedAt: existing?.completedAt || new Date().toISOString(),
      latestResult: { completedAt: new Date().toISOString(), score: null, band: result.feedback.overallBand }, evaluation: { ...claim.evaluation!, status: "done", result } };
    return await saveLessonAssessment(userId, course.id, lessonId, "application", stored.version, randomUUID(), hash, finished);
  } catch {
    await saveLessonAssessment(userId, course.id, lessonId, "application", stored.version, randomUUID(), hash,
      { ...stored, version: stored.version + 1, attempt: input.attempt, evaluation: { ...claim.evaluation!, status: "failed" } });
    throw new AssessmentError("ASSESSMENT_UNAVAILABLE", 503);
  }
}

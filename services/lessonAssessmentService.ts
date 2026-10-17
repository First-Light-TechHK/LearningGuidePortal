import { createHash } from "node:crypto";
import { AssessmentError, parseAssessmentWrite, type AssessmentKind, type AssessmentSummary, type SavedAssessment } from "@/contracts/lesson-assessment";
import { checkEntitlement, getProductCourse, getLearningOverview } from "@/services/productStore";
import { listLessonAssessments, saveLessonAssessment } from "@/repositories/lessonAssessmentRepository";
import { getKnowledgeTestSamples } from "@/lib/knowledgeTestSamples";
import { reviewKnowledgeResponses } from "@/lib/knowledgeTest";
import { APPLICATION_TEST_EVALUATION_MS } from "@/contracts/application-test";

export async function assessmentContext(userId: string, courseId: string) {
  const course = await getProductCourse(courseId);
  if (!course || course.status !== "published") throw new AssessmentError("ASSESSMENT_NOT_FOUND", 404);
  if (!(await checkEntitlement(userId, course.id)).allowed) throw new AssessmentError("ASSESSMENT_FORBIDDEN", 403);
  const overview = await getLearningOverview(userId);
  const completedLessons = new Set(overview.courses.find(item => item.courseId === course.id)?.completedLessonIds || []);
  return { course, completedLessons };
}
export function summariseAssessment(record: SavedAssessment | undefined, kind: AssessmentKind): AssessmentSummary {
  const total = kind === "knowledge" ? getKnowledgeTestSamples("en-GB").length : 1;
  if (!record) return { status: "not_started", answered: 0, total, percent: 0, score: null };
  if (record.attempt.kind === "knowledge") {
    const result = reviewKnowledgeResponses(record.attempt.responses);
    const answered = record.attempt.responses.filter(response => response.rating !== null).length;
    return { status: result.complete ? "completed" : "in_progress", answered, total, percent: Math.floor(answered / total * 100), score: result.complete ? result.percent : null };
  }
  const submitted = record.attempt.phase === "submitted";
  return { status: submitted ? "completed" : "in_progress", answered: submitted ? 1 : 0, total, percent: submitted ? 100 : 0, score: null };
}
export async function readAssessment(userId: string, courseId: string, lessonId: string, kind: AssessmentKind) {
  const { course, completedLessons } = await assessmentContext(userId, courseId);
  if (!course.sections.some(section => section.lessons.some(lesson => lesson.id === lessonId))) throw new AssessmentError("ASSESSMENT_NOT_FOUND", 404);
  const record = (await listLessonAssessments(userId, course.id)).find(item => item.lessonId === lessonId && item.kind === kind) || null;
  if (!completedLessons.has(lessonId) && !record) throw new AssessmentError("ASSESSMENT_FORBIDDEN", 403);
  return record;
}
export async function writeAssessment(userId: string, courseId: string, lessonId: string, kind: AssessmentKind, value: unknown) {
  const input = parseAssessmentWrite(value);
  if (kind !== input.attempt.kind) throw new AssessmentError("ASSESSMENT_INVALID");
  const { course, completedLessons } = await assessmentContext(userId, courseId);
  if (!course.sections.some(section => section.lessons.some(lesson => lesson.id === lessonId))) throw new AssessmentError("ASSESSMENT_NOT_FOUND", 404);
  const existing = (await listLessonAssessments(userId, course.id)).find(item => item.lessonId === lessonId && item.kind === kind);
  if (!completedLessons.has(lessonId) && !existing) throw new AssessmentError("ASSESSMENT_FORBIDDEN", 403);
  const attempt = input.attempt;
  let evaluationStartedAt: string | null = null;
  if (attempt.kind === "knowledge") {
    const count = getKnowledgeTestSamples("en-GB").length;
    if (attempt.responses.length !== count || attempt.index < 0 || attempt.index >= count || (attempt.phase === "result" && !reviewKnowledgeResponses(attempt.responses).complete)) throw new AssessmentError("ASSESSMENT_INVALID");
  }
  if (attempt.kind === "application" && attempt.phase !== "answer") {
    const previous = existing?.attempt.kind === "application" ? existing.attempt : null;
    const sameAnswer = previous?.answer === attempt.answer;
    evaluationStartedAt = sameAnswer && previous?.phase !== "answer" ? existing?.evaluationStartedAt || null : null;
    if (attempt.phase === "submitted") {
      const alreadyFinished = sameAnswer && previous?.phase === "submitted";
      if (!alreadyFinished && (!sameAnswer || previous?.phase !== "evaluating" || !evaluationStartedAt
        || Date.now() - Date.parse(evaluationStartedAt) < APPLICATION_TEST_EVALUATION_MS)) throw new AssessmentError("ASSESSMENT_INVALID");
    } else {
      if (previous?.phase === "submitted" || previous?.phase === "evaluating" && !sameAnswer) throw new AssessmentError("ASSESSMENT_CONFLICT", 409);
      evaluationStartedAt ||= new Date().toISOString();
    }
  }
  const finished = attempt.kind === "knowledge" ? reviewKnowledgeResponses(attempt.responses).complete : attempt.phase === "submitted";
  const timestamp = new Date().toISOString();
  const record: SavedAssessment = { lessonId, kind, version: input.expectedVersion + 1, attempt, updatedAt: timestamp, completedAt: finished ? existing?.completedAt || timestamp : null, ...(kind === "application" ? { evaluationStartedAt } : {}) };
  return saveLessonAssessment(userId, course.id, lessonId, kind, input.expectedVersion, input.clientEventId, createHash("sha256").update(JSON.stringify(input)).digest("hex"), record);
}

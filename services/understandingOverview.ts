import type { UnderstandingOverviewDisplay } from "@/contracts/understanding-overview";
import { listLessonAssessments } from "@/repositories/lessonAssessmentRepository";
import { assessmentContext, assessmentWasCompleted, summariseAssessment } from "./lessonAssessmentService";
import { lessonAssessmentAvailability } from "@/lib/lessonResources";

export async function getUnderstandingOverview(userId: string, courseId: string): Promise<UnderstandingOverviewDisplay> {
  const { course } = await assessmentContext(userId, courseId);
  const records = await listLessonAssessments(userId, course.id);
  const courseLessons=course.sections.flatMap(section=>section.lessons);
  const lessons = courseLessons.map((lesson, index) => {
    const knowledgeRecord = records.find(record => record.lessonId === lesson.id && record.kind === "knowledge");
    const applicationRecord = records.find(record => record.lessonId === lesson.id && record.kind === "application");
    const available = lessonAssessmentAvailability(lesson);
    const knowledge = summariseAssessment(knowledgeRecord, "knowledge", available.knowledge), application = summariseAssessment(applicationRecord, "application", Number(available.application), Boolean(lesson.assessments));
    const state = assessmentWasCompleted(knowledgeRecord) && assessmentWasCompleted(applicationRecord) ? "completed" : "current";
    return { id: lesson.id, number: String(index + 1).padStart(2, "0"), title: lesson.title, state, knowledge, application } as UnderstandingOverviewDisplay["lessons"][number];
  });
  const completed = lessons.reduce((count,lesson)=>count+( ["knowledge","application"] as const).filter(kind=>assessmentWasCompleted(records.find(record=>record.lessonId===lesson.id&&record.kind===kind))).length,0);
  const total=lessons.reduce((count,lesson)=>count+Number(lesson.knowledge.total>0)+Number(lesson.application.total>0),0);
  return { lessons, completed, total, percent: total ? Math.floor(completed / total * 100) : 0 };
}

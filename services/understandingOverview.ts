import type { UnderstandingOverviewDisplay } from "@/contracts/understanding-overview";
import { listLessonAssessments } from "@/repositories/lessonAssessmentRepository";
import { assessmentContext, summariseAssessment } from "./lessonAssessmentService";

export async function getUnderstandingOverview(userId: string, courseId: string): Promise<UnderstandingOverviewDisplay> {
  const { course, completedLessons } = await assessmentContext(userId, courseId);
  const records = await listLessonAssessments(userId, course.id);
  const lessons = course.sections.flatMap(section => section.lessons).map((lesson, index) => {
    const knowledgeRecord = records.find(record => record.lessonId === lesson.id && record.kind === "knowledge");
    const applicationRecord = records.find(record => record.lessonId === lesson.id && record.kind === "application");
    const knowledge = summariseAssessment(knowledgeRecord, "knowledge"), application = summariseAssessment(applicationRecord, "application");
    const state = knowledge.status === "completed" && application.status === "completed" ? "completed" : completedLessons.has(lesson.id) || knowledgeRecord || applicationRecord ? "current" : "locked";
    return { id: lesson.id, number: String(index + 1).padStart(2, "0"), title: lesson.title, state, knowledge, application } as UnderstandingOverviewDisplay["lessons"][number];
  });
  const completed = lessons.filter(lesson => lesson.state === "completed").length;
  return { lessons, completed, total: lessons.length, percent: lessons.length ? Math.floor(completed / lessons.length * 100) : 0 };
}

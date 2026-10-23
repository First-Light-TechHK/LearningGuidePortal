import type { UnderstandingOverviewDisplay } from "@/contracts/understanding-overview";
import { listLessonAssessments } from "@/repositories/lessonAssessmentRepository";
import { assessmentContext, assessmentWasCompleted, summariseAssessment, unlockedAssessmentLessons } from "./lessonAssessmentService";

export async function getUnderstandingOverview(userId: string, courseId: string): Promise<UnderstandingOverviewDisplay> {
  const { course, completedLessons } = await assessmentContext(userId, courseId);
  const records = await listLessonAssessments(userId, course.id);
  const courseLessons=course.sections.flatMap(section=>section.lessons);
  const unlocked=unlockedAssessmentLessons(courseLessons,completedLessons,records);
  const lessons = courseLessons.map((lesson, index) => {
    const knowledgeRecord = records.find(record => record.lessonId === lesson.id && record.kind === "knowledge");
    const applicationRecord = records.find(record => record.lessonId === lesson.id && record.kind === "application");
    const knowledge = summariseAssessment(knowledgeRecord, "knowledge"), application = summariseAssessment(applicationRecord, "application");
    const state = assessmentWasCompleted(knowledgeRecord) && assessmentWasCompleted(applicationRecord) ? "completed" : unlocked.has(lesson.id) ? "current" : "locked";
    return { id: lesson.id, number: String(index + 1).padStart(2, "0"), title: lesson.title, state, knowledge, application } as UnderstandingOverviewDisplay["lessons"][number];
  });
  const completed = lessons.reduce((count,lesson)=>count+( ["knowledge","application"] as const).filter(kind=>assessmentWasCompleted(records.find(record=>record.lessonId===lesson.id&&record.kind===kind))).length,0);
  const total=lessons.length*2;
  return { lessons, completed, total, percent: total ? Math.floor(completed / total * 100) : 0 };
}

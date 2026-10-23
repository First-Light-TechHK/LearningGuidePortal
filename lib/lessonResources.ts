import type { LessonResources, AssessmentAvailability } from "@/contracts/lesson-resources";
import type { ExplorationDisplay } from "@/contracts/exploration";
import { getKnowledgeTestSamples } from "./knowledgeTestSamples";

export function lessonAssessmentAvailability(lesson: Pick<LessonResources, "assessments">): AssessmentAvailability {
  return lesson.assessments ? { knowledge: lesson.assessments.knowledge.length, application: Boolean(lesson.assessments.application) }
    : { knowledge: getKnowledgeTestSamples("en-GB").length, application: true };
}

/** Only call after server Course access checks; no authored resources are sent to previews. */
export function courseExploration(course: {sections: {lessons: LessonResources[]}[]}): ExplorationDisplay | undefined {
  const lessons = course.sections.flatMap(section => section.lessons);
  if (!lessons.some(lesson => lesson.exploration)) return undefined;
  return { readings: lessons.flatMap(lesson => lesson.exploration?.readings || []), exhibits: lessons.flatMap(lesson => lesson.exploration?.exhibits || []) };
}

import type { CourseLearningMode, CourseModePosition } from "@/contracts/course-learning-mode";
import type { ProductCourse, ProductStudyEvent, ProductStudyRecord } from "@/services/productStore";
import { courseKnowledgePoints } from "@/lib/knowledgeProgress";

/** A mode's furthest owned point is independent of its movable review cursor. */
export function courseModePosition({ course, mode, userId, record, events, fallbackLessonId, accessiblePoints }: {
  course: Pick<ProductCourse, "id" | "sections">;
  mode: CourseLearningMode;
  userId: string;
  record?: ProductStudyRecord;
  events: ProductStudyEvent[];
  fallbackLessonId: string;
  accessiblePoints: CourseModePosition[];
}): CourseModePosition | null {
  const allPoints = courseKnowledgePoints(course, mode);
  const points = allPoints.filter(point => accessiblePoints.some(allowed => allowed.lessonId === point.lessonId && allowed.contentId === point.contentId));
  if (!points.length) return null;
  let furthest = -1;
  const consider = (position?: CourseModePosition | null) => {
    if (!position) return;
    const index = points.findIndex(point => point.lessonId === position.lessonId && point.contentId === position.contentId);
    if (index > furthest) furthest = index;
  };
  if (record?.userId === userId && record.courseId === course.id) {
    consider(record.knowledgePositions?.[mode]);
    if (record.highestProgress?.mode === mode) consider(record.highestProgress);
  }
  const owned = events.filter(event => event.userId === userId && event.courseId === course.id);
  for (const event of owned) {
    if (event.learningMode === mode) consider({ lessonId: event.lessonId, contentId: event.contentId || null });
  }
  const position = furthest >= 0 ? points[furthest] : points.find(point => point.lessonId === fallbackLessonId) || points[0];
  const lessonEvents = owned.filter(event => event.lessonId === position.lessonId && event.event === "complete");
  const completed = lessonEvents.some(event => !event.learningMode && !event.contentId)
    || (["text", "video"] as const).some(completedMode => {
      const lessonPoints = courseKnowledgePoints(course, completedMode).filter(point => point.lessonId === position.lessonId);
      const valid = lessonEvents.filter(event => event.learningMode === completedMode
        && lessonPoints.some(point => point.contentId === (event.contentId || null)));
      return valid.some(event => event.completeLesson)
        || lessonPoints.length > 0 && lessonPoints.every(point => valid.some(event => (event.contentId || null) === point.contentId));
    });
  return completed ? points.filter(point => point.lessonId === position.lessonId).at(-1)! : position;
}

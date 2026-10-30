import type { CourseLearningMode, CourseModePosition } from "@/contracts/course-learning-mode";
import type { ProductCourse, ProductStudyEvent, ProductStudyRecord } from "@/services/productStore";
import { courseKnowledgePoints } from "@/lib/knowledgeProgress";

/** Resume the mode's latest owned cursor, including deliberate backward review. */
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
  const available = (position?: CourseModePosition | null) => position
    ? points.find(point => point.lessonId === position.lessonId && point.contentId === position.contentId)
    : undefined;
  if (record?.userId === userId && record.courseId === course.id) {
    const cursor = available(record.knowledgePositions?.[mode]);
    if (cursor) return cursor;
  }
  // Legacy records can recover from server-timed events. Equal timestamps use
  // their append order, matching the atomic Study cursor update.
  let latest: CourseModePosition | undefined;
  let latestAt = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    if (event.userId !== userId || event.courseId !== course.id || event.learningMode !== mode) continue;
    const position = available({ lessonId: event.lessonId, contentId: event.contentId || null });
    if (!position) continue;
    const timestamp = Date.parse(event.createdAt);
    const at = Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
    if (!latest || at >= latestAt) { latest = position; latestAt = at; }
  }
  return latest || points.find(point => point.lessonId === fallbackLessonId) || points[0];
}

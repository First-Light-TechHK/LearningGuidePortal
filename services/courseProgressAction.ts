import type { ProductCourse, ProductStudyEvent, ProductStudyRecord } from "./productStore";
import { courseKnowledgePoints, knowledgePositionAtProgress, knowledgeProgress, pointPercentage } from "@/lib/knowledgeProgress";

/** The course Start target follows the maximum, independently of the resume cursor. */
export function highestProgressLesson(course: ProductCourse, record: ProductStudyRecord | undefined, events: ProductStudyEvent[]): string | null {
  const lessons = course.sections.flatMap(section => section.lessons);
  if (!record) return lessons[0]?.id || null;
  if (record.completedAt || record.progress >= 100) return lessons.at(-1)?.id || null;
  if (record.progress <= 0) return lessons[0]?.id || null;
  const saved = record.highestProgress;
  if (saved?.progress === record.progress && lessons.some(lesson => lesson.id === saved.lessonId)
    && (saved.mode === null || knowledgeProgress(course, saved.mode, saved).lessonId)) return saved.lessonId;

  // Old records have only a percentage and a movable cursor. Recover the
  // maximum's location from validated historical events without rewriting them.
  let highest: { progress: number; lessonId: string } | undefined;
  for (const event of events) {
    if (event.userId !== record.userId || event.courseId !== course.id || !event.learningMode) continue;
    const point = event.completeLesson
      ? courseKnowledgePoints(course, event.learningMode).filter(point => point.lessonId === event.lessonId).at(-1)
      : { lessonId: event.lessonId, contentId: event.contentId || null };
    const position = knowledgeProgress(course, event.learningMode, point);
    if (!position.lessonId || position.progress > record.progress) continue;
    if (!highest || position.progress > highest.progress || position.progress === highest.progress
      && lessons.findIndex(lesson => lesson.id === position.lessonId) > lessons.findIndex(lesson => lesson.id === highest!.lessonId)) {
      highest = { progress: position.progress, lessonId: position.lessonId };
    }
  }
  if (highest?.progress === record.progress) return highest.lessonId;
  const point = saved?.progress === record.progress && saved.mode ? knowledgePositionAtProgress(course, saved.mode, record.progress) : null;
  return point?.lessonId || lessons.find((_, index) => pointPercentage(index + 1, lessons.length) >= record.progress)?.id || lessons.at(-1)?.id || null;
}

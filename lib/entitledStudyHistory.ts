import type { ProductCourse, ProductStudyEvent, ProductStudyRecord } from "@/services/productStore";
import { courseKnowledgePoints } from "./knowledgeProgress";

/** Preview history never becomes entitled progress. Legacy rows are projected without deleting events. */
export function entitledStudyHistory(course: ProductCourse, record: ProductStudyRecord | undefined, events: ProductStudyEvent[],
  evidence: { hasAccessHistory: boolean; firstAccessAt: number | null }) {
  const accepted = events.filter(event => event.accessContext === "entitled" || event.accessContext !== "preview"
    && evidence.hasAccessHistory && (evidence.firstAccessAt === null || Date.parse(event.createdAt) >= evidence.firstAccessAt));
  if (record && accepted.length === events.length && (record.accessContext === "entitled"
    || evidence.hasAccessHistory && (evidence.firstAccessAt === null || Date.parse(record.startedAt) >= evidence.firstAccessAt))) {
    const projected = { ...record, progress: 0, completedAt: null };
    delete projected.highestProgress;
    return { record: projected, events: accepted };
  }
  if (!accepted.length) return { record: undefined, events: accepted };
  const ordered = accepted.map((event, index) => ({ event, index })).sort((a, b) => Date.parse(a.event.createdAt) - Date.parse(b.event.createdAt) || a.index - b.index).map(item => item.event);
  const rebuilt: ProductStudyRecord = { id: record?.id || `study_recovered_${ordered[0].id}`, userId: ordered[0].userId, courseId: course.id,
    accessContext: "entitled", startedAt: ordered[0].createdAt, updatedAt: ordered[0].createdAt, currentLessonId: null,
    totalSeconds: 0, progress: 0, completedAt: null, lessonBookmarks: record?.lessonBookmarks, ...(record?.selectedMode ? { selectedMode: record.selectedMode } : {}) };
  const lessons = course.sections.flatMap(section => section.lessons), opened = new Set<string>();
  for (const event of ordered) {
    if (!lessons.some(lesson => lesson.id === event.lessonId)) continue;
    opened.add(event.lessonId); rebuilt.currentLessonId = event.lessonId; rebuilt.updatedAt = event.createdAt;
    rebuilt.totalSeconds += Math.max(0, event.seconds);
    let contentId = event.contentId || null;
    if (event.learningMode) {
      if (event.completeLesson) contentId = courseKnowledgePoints(course, event.learningMode).filter(point => point.lessonId === event.lessonId).at(-1)?.contentId || null;
      rebuilt.currentMode = event.learningMode;
      rebuilt.knowledgePositions = { ...rebuilt.knowledgePositions, [event.learningMode]: { lessonId: event.lessonId, contentId } };
    }

  }
  rebuilt.totalSeconds = Math.min(rebuilt.totalSeconds, lessons.reduce((sum, lesson) => sum + lesson.durationMinutes * 60, 0));
  return { record: rebuilt, events: accepted };
}

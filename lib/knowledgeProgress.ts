import type { ProductCourse } from "@/services/productStore";
import type { CourseLearningMode } from "@/contracts/course-learning-mode";
import type { KnowledgePosition, KnowledgeProgress } from "@/contracts/knowledge-progress";

export function courseKnowledgePoints(course: Pick<ProductCourse, "sections">, mode: CourseLearningMode) {
  return course.sections.flatMap(section => section.lessons.flatMap(lesson => {
    const active = (lesson.contents || []).filter(content => content.active !== false);
    const points: KnowledgePosition[] = active.filter(content => mode === "video" ? content.type === "video" : content.type === "text" || content.type === "pdf")
      .map(content => ({ lessonId: lesson.id, contentId: content.id }));
    if (mode === "text" && !active.length && lesson.body?.trim()) points.push({ lessonId: lesson.id, contentId: null });
    return points;
  }));
}

/** Current ordered point / all active points of the same course presentation. */
export function knowledgeProgress(course: Pick<ProductCourse, "sections">, mode: CourseLearningMode, position?: KnowledgePosition): KnowledgeProgress {
  const points = courseKnowledgePoints(course, mode);
  const index = position ? points.findIndex(point => point.lessonId === position.lessonId && point.contentId === position.contentId) : -1;
  const current = index + 1;
  return { mode, current, total: points.length, progress: points.length ? Math.round(current / points.length * 100) : 0,
    lessonId: index >= 0 ? points[index].lessonId : null, contentId: index >= 0 ? points[index].contentId : null };
}

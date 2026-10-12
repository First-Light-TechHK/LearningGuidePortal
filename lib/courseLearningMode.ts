import type { CourseLearningMode } from "@/contracts/course-learning-mode";
import type { LessonContent } from "@/contracts/lesson-content";
import type { ProductCourse } from "@/services/productStore";
import { lessonLearningModes } from "@/lib/previewLessonPresentation";

/** Course-wide availability uses active content metadata, without exposing media. */
export function availableCourseLearningModes(course: Pick<ProductCourse, "sections">): CourseLearningMode[] {
  const available = new Set(course.sections.flatMap(section => section.lessons.flatMap(lessonLearningModes)));
  return (["video", "text"] as const).filter(mode => available.has(mode));
}

/** Stay on a matching lesson; otherwise use the first accessible lesson of that mode. */
export function modeLessonDestination(outline: Array<{id:string;href:string|null;modes?:CourseLearningMode[]}>, lessonId:string, mode:CourseLearningMode, currentHasMode:boolean, contentId?:string) {
  const current=currentHasMode ? outline.find(item=>item.id===lessonId&&item.href) : undefined;
  const destination=current || outline.find(item=>item.href&&item.modes?.includes(mode));
  if(!destination?.href)return null;
  const url=new URL(destination.href,"https://learning-guide.invalid");
  url.searchParams.set("viewMode",mode);
  url.searchParams.delete("contentId");
  if(current&&contentId)url.searchParams.set("contentId",contentId);
  return {lessonId:destination.id,href:url.pathname+url.search+url.hash};
}

/** Selects the preferred content presentation without granting course access. */
export function preferredLessonContentId(contents: LessonContent[], mode: CourseLearningMode | null = null) {
  const active = contents.filter(item => item.active !== false);
  const preferred = active.find(item => mode === "text" ? item.type === "text" || item.type === "pdf" : item.type === "video");
  return preferred?.id || active[0]?.id || "";
}

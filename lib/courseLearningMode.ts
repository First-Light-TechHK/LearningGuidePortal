import type { CourseLearningMode, CourseModePosition } from "@/contracts/course-learning-mode";
import type { LessonContent } from "@/contracts/lesson-content";
import type { ProductCourse } from "@/services/productStore";
import { lessonLearningModes } from "@/lib/previewLessonPresentation";

/** Course-wide availability uses active content metadata, without exposing media. */
export function availableCourseLearningModes(course: Pick<ProductCourse, "sections">): CourseLearningMode[] {
  const available = new Set(course.sections.flatMap(section => section.lessons.flatMap(lessonLearningModes)));
  return (["video", "text"] as const).filter(mode => available.has(mode));
}

/** Prefer the server's last mode cursor, retaining accessible entry fallbacks. */
export function modeLessonDestination(outline: Array<{id:string;href:string|null;modes?:CourseLearningMode[]}>, lessonId:string, mode:CourseLearningMode, currentHasMode:boolean, contentId?:string, position?:CourseModePosition|null) {
  if (position === null) return null;
  const resumed = position ? outline.find(item => item.id === position.lessonId && item.href && (!item.modes || item.modes.includes(mode))) : undefined;
  const current=currentHasMode ? outline.find(item=>item.id===lessonId&&item.href) : undefined;
  const destination=resumed || current || outline.find(item=>item.href&&item.modes?.includes(mode));
  if(!destination?.href)return null;
  const url=new URL(destination.href,"https://learning-guide.invalid");
  url.searchParams.set("viewMode",mode);
  url.searchParams.delete("contentId");
  const selected = resumed ? position?.contentId : current ? contentId : undefined;
  if(selected)url.searchParams.set("contentId",selected);
  return {lessonId:destination.id,href:url.pathname+url.search+url.hash};
}

/** Selects the preferred content presentation without granting course access. */
export function preferredLessonContentId(contents: LessonContent[], mode: CourseLearningMode | null = null) {
  const active = contents.filter(item => item.active !== false);
  const preferred = active.find(item => mode === "text" ? item.type === "text" || item.type === "pdf" : item.type === "video");
  return preferred?.id || active[0]?.id || "";
}

/** Validate resumed content against the requested mode and current lesson. */
export function resolveLessonPresentation(contents: LessonContent[], preferredMode: CourseLearningMode | null, initialContentId?: string | null) {
  const active = contents.filter(content => content.active !== false);
  const initial = active.find(content => content.id === initialContentId && (preferredMode === null || (preferredMode === "video" ? content.type === "video" : content.type === "text" || content.type === "pdf")));
  const contentId = initial?.id || preferredLessonContentId(active, preferredMode);
  const selected = active.find(content => content.id === contentId);
  return { contentId, mode: (selected?.type === "video" ? "video" : "text") as CourseLearningMode };
}

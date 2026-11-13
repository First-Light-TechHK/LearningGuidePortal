import type { ProductLesson, ProductPlan } from "@/services/productStore";
import type { CoursePage } from "@/lib/coursePage";

/** Keep one curriculum action prominent without changing the stored resume destination. */
export function coursePrimaryLessonId(page: Pick<CoursePage, "syllabus" | "actionLessonId">): string | null {
  const accessible = page.syllabus.filter(lesson => lesson.access === "entitled" && lesson.openable);
  const unfinished = accessible.filter(lesson => !lesson.completed);
  return (unfinished.find(lesson => lesson.lessonId === page.actionLessonId)
    ?? unfinished.find(lesson => lesson.continuable)
    ?? unfinished[0]
    ?? accessible[0])?.lessonId ?? null;
}

/** Display actual media duration; never infer it from the lesson's position. */
export function courseLessonDuration(lesson?: Pick<ProductLesson, "durationMinutes" | "videoDurationSeconds">) {
  if (!lesson) return "—";
  const seconds = Math.max(0, Math.round(lesson.videoDurationSeconds ?? lesson.durationMinutes * 60));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Keep course totals in whole-hour and remaining-minute form for the course detail UI. */
export function courseDurationParts(totalMinutes: number) {
  const minutes = Number.isFinite(totalMinutes) ? Math.max(0, Math.round(totalMinutes)) : 0;
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

export function courseCategoryPlan(plans: ProductPlan[], category: string) {
  return plans.find((plan) => plan.scope === "category" && plan.device === "pc" &&
    plan.termMonths === 6 && plan.available !== false && (plan.scopeId || plan.category) === category);
}

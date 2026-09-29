import type { ProductLesson, ProductPlan } from "@/services/productStore";

/** Display actual media duration; never infer it from the lesson's position. */
export function courseLessonDuration(lesson?: Pick<ProductLesson, "durationMinutes" | "videoDurationSeconds">) {
  if (!lesson) return "—";
  const seconds = Math.max(0, Math.round(lesson.videoDurationSeconds ?? lesson.durationMinutes * 60));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function courseCategoryPlan(plans: ProductPlan[], category: string) {
  return plans.find((plan) => plan.scope === "category" && plan.device === "pc" &&
    plan.termMonths === 6 && plan.available !== false && (plan.scopeId || plan.category) === category);
}

/** Outcomes stored on the course, then on a related catalogue entry. Never a shared stand-in list. */
export function courseLearningOutcomes(...sources: Array<unknown>): string[] {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const outcomes = normalisedOutcomes((source as { outcomes?: unknown }).outcomes);
    if (outcomes.length) return outcomes;
  }
  return [];
}

function normalisedOutcomes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const outcomes: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    outcomes.push(text);
  }
  return outcomes;
}

import type { AiPointsPlan } from "@/contracts/plan-ai-points";

function productKey(plan: AiPointsPlan) {
  const scope = plan.scope || (plan.courseId === "*" ? "everything" : "course");
  return JSON.stringify([scope, scope === "everything" ? "*" : plan.scopeId || (scope === "category" ? plan.category : plan.courseId), plan.device]);
}

const SUBSCRIPTION_AI_POINTS = {
  category: { 6: 500, 12: 1100 },
  everything: { 6: 1500, 12: 3100 },
} as const;

/** Current PC subscription offers; retain the existing rule for other products. */
export function withPlanAiPoints<T extends AiPointsPlan>(plans: readonly T[]): T[] {
  const sixMonthPoints = new Map(plans.filter(plan => plan.termMonths === 6 && Number.isSafeInteger(plan.aiPoints) && plan.aiPoints! >= 0).map(plan => [productKey(plan), plan.aiPoints!]));
  return plans.map(plan => {
    const scope = plan.scope || (plan.courseId === "*" ? "everything" : "course");
    if (plan.device === "pc" && (scope === "category" || scope === "everything")) {
      return { ...plan, aiPoints: SUBSCRIPTION_AI_POINTS[scope][plan.termMonths] };
    }
    const base = sixMonthPoints.get(productKey(plan));
    return plan.termMonths === 12 && base !== undefined && Number.isSafeInteger(base * 2) ? { ...plan, aiPoints: base * 2 } : plan;
  });
}

import type { AiPointsPlan } from "@/contracts/plan-ai-points";

function productKey(plan: AiPointsPlan) {
  const scope = plan.scope || (plan.courseId === "*" ? "everything" : "course");
  return JSON.stringify([scope, scope === "everything" ? "*" : plan.scopeId || (scope === "category" ? plan.category : plan.courseId), plan.device]);
}

/** Current catalogue rule: an annual plan includes twice its matching six-month points. */
export function withAnnualAiPoints<T extends AiPointsPlan>(plans: readonly T[]): T[] {
  const sixMonthPoints = new Map(plans.filter(plan => plan.termMonths === 6 && Number.isSafeInteger(plan.aiPoints) && plan.aiPoints! >= 0).map(plan => [productKey(plan), plan.aiPoints!]));
  return plans.map(plan => {
    const base = sixMonthPoints.get(productKey(plan));
    return plan.termMonths === 12 && base !== undefined && Number.isSafeInteger(base * 2) ? { ...plan, aiPoints: base * 2 } : plan;
  });
}

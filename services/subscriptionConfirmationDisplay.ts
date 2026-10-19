import type { SubscriptionConfirmationDisplay } from "@/contracts/subscription-confirmation";
import type { ProductPlan, ProductQuote, ProductSubscription } from "./productStore";

export function buildSubscriptionConfirmationDisplay({ quote, plan, categoryCount, source, sourcePlan, sourceCategory }: {
  quote: ProductQuote; plan: ProductPlan; categoryCount: number;
  source?: ProductSubscription; sourcePlan?: ProductPlan; sourceCategory?: string;
}): SubscriptionConfirmationDisplay {
  let schedule: SubscriptionConfirmationDisplay["schedule"] = null;
  const startsAt = new Date(quote.createdAt);
  if (quote.kind !== "trial" && quote.kind !== "upgrade" && Number.isFinite(startsAt.getTime())) {
    const renewsAt = new Date(startsAt);
    // Clamp month-end estimates instead of overflowing into the following month.
    renewsAt.setUTCDate(1);
    renewsAt.setUTCMonth(renewsAt.getUTCMonth() + plan.termMonths);
    const lastDay = new Date(Date.UTC(renewsAt.getUTCFullYear(), renewsAt.getUTCMonth() + 1, 0)).getUTCDate();
    renewsAt.setUTCDate(Math.min(startsAt.getUTCDate(), lastDay));
    schedule = { startsAt: startsAt.toISOString(), endsAt: new Date(renewsAt.getTime() - 86_400_000).toISOString(), renewsAt: renewsAt.toISOString() };
  }
  const periodEnd = quote.upgradeProration ? quote.upgradeProration.periodEnd * 1000 : source ? Date.parse(source.validTo) : NaN;
  const prorationDate = quote.upgradeProration?.prorationDate;
  const upgrade = quote.kind === "upgrade" && source && Number.isFinite(periodEnd) ? {
    sourceCategory: sourceCategory || sourcePlan?.category || sourcePlan?.name || "",
    sourceAiPoints: sourcePlan?.aiPoints ?? 0,
    validUntil: new Date(periodEnd - 1).toISOString(),
    renewsAt: new Date(periodEnd).toISOString(),
    remainingDays: prorationDate == null ? null : Math.max(0, Math.ceil((periodEnd / 1000 - prorationDate) / 86_400)),
  } : null;
  const scope = plan.scope || (plan.courseId === "*" ? "everything" : "course");
  return { planKind: scope === "category" ? "category" : scope === "everything" ? "everything" : "course", categoryCount, schedule, upgrade };
}

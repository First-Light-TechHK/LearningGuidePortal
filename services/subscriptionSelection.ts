import type { SubscriptionSelectionState } from "@/contracts/subscription-selection";
import type { ProductPlan, ProductSubscription } from "./productStore";
import { withAnnualAiPoints } from "./planAiPoints";

export function livePaidSubscriptions(subscriptions: ProductSubscription[], userId: string, at = Date.now()) {
  return subscriptions.filter(item => item.userId === userId && item.source === "purchase"
    && ["active", "cancel_at_period_end", "grace"].includes(item.state)
    && Date.parse(item.state === "grace" ? item.graceEndsAt || item.validTo : item.validTo) > at);
}

export function subscriptionCoverage(subscriptions: ProductSubscription[], plans: ProductPlan[], userId: string, at = Date.now()) {
  const live = livePaidSubscriptions(subscriptions, userId, at);
  const scope = (item: ProductSubscription) => item.scope || plans.find(plan => plan.id === item.planId)?.scope || (item.courseId === "*" ? "everything" : "course");
  const categories = live.filter(item => scope(item) === "category");
  return { everything: live.find(item => scope(item) === "everything"), categories,
    categoryIds: [...new Set(categories.map(item => item.scopeId || plans.find(plan => plan.id === item.planId)?.scopeId || plans.find(plan => plan.id === item.planId)?.category).filter((id): id is string => Boolean(id)))] };
}

export function buildSubscriptionSelection(subscriptions: ProductSubscription[], plans: ProductPlan[], userId: string, at = Date.now()): SubscriptionSelectionState {
  plans = withAnnualAiPoints(plans);
  const coverage = subscriptionCoverage(subscriptions, plans, userId, at);
  const source = coverage.categoryIds.length === 1 ? coverage.categories.find(item => item.state === "active" && (item.device || plans.find(plan => plan.id === item.planId)?.device || "pc") === "pc") || coverage.categories[0] : null;
  const sourcePlan = source && plans.find(plan => plan.id === source.planId);
  const everythingPlan = coverage.everything && plans.find(plan => plan.id === coverage.everything!.planId);
  return {
    kind: coverage.everything ? "everything" : coverage.categoryIds.length >= 3 ? "all_categories" : coverage.categoryIds.length === 2 ? "two_categories" : coverage.categoryIds.length === 1 ? "one_category" : "none",
    ownedCategoryIds: coverage.categoryIds,
    categoryRenewals: coverage.categories.every(item => item.state === "active" && !item.cancelAtPeriodEnd),
    categorySubscription: source ? { id: source.id, validTo: source.validTo, remainingDays: Math.max(0, Math.ceil((Date.parse(source.validTo) - at) / 86_400_000)),
      canUpgrade: !coverage.everything && source.state === "active" && !source.cancelAtPeriodEnd && Boolean(source.stripeSubscriptionId && source.stripeCustomerId && sourcePlan) && (source.device || sourcePlan?.device) === "pc", aiPoints: sourcePlan?.aiPoints || 0, termMonths: sourcePlan?.termMonths || 6 } : null,
    everything: coverage.everything ? { validTo: coverage.everything.validTo, renewal: coverage.everything.state === "active" && !coverage.everything.cancelAtPeriodEnd,
      paymentPending: coverage.everything.state === "grace", amountMinor: everythingPlan?.amountMinor ?? null, currency: everythingPlan?.currency || "usd" } : null,
  };
}

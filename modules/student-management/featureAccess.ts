// Feature access rules (PRD 6.2, plus the emergency off decided 2026-11-02). Pure functions over the product
// aggregate: no I/O, so every request decides from the data it already read and a saved change applies on the
// learner's next request (PRD 6.4).
import { FEATURE_KEYS, type AccessReason, type FeatureKey, type OverrideValue } from "@/contracts/student-management";
import { withPlanAiPoints } from "@/services/planAiPoints";
import type { FeatureAccessState, ProductData, ProductPlan, ProductSubscription, ProductUser } from "@/services/productStore";

/** Developer-maintained catalogue (PRD 6.1). Defaults apply until an employee saves a global value. */
export const FEATURE_CATALOGUE: Record<FeatureKey, { defaultEnabled: boolean; prerequisite: "ai_tutor" | "active_account" }> = {
  improve_tutor: { defaultEnabled: false, prerequisite: "ai_tutor" },
  // Owner decision 2026-11-02: the AI Support Assistant is already live, so it stays on until an employee turns it off.
  ai_support_assistant: { defaultEnabled: true, prerequisite: "active_account" },
};

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

export function featureState(data: ProductData): FeatureAccessState {
  return data.featureAccess ?? { globals: [], overrides: [], version: 0 };
}

export function globalSetting(data: ProductData, feature: FeatureKey) {
  const saved = featureState(data).globals.find((item) => item.feature === feature);
  return { enabled: saved ? saved.enabled : FEATURE_CATALOGUE[feature].defaultEnabled, emergencyOff: saved?.emergencyOff ?? null, updated: saved?.updated ?? null };
}

export function overrideFor(data: ProductData, userId: string, feature: FeatureKey): OverrideValue {
  return featureState(data).overrides.find((item) => item.userId === userId && item.feature === feature)?.value ?? "default";
}

/** A subscription that still gives access now (paid, trial, ending or in its grace period). */
export function isCurrentSubscription(subscription: ProductSubscription, at = Date.now()) {
  if (!["active", "cancel_at_period_end", "grace"].includes(subscription.state)) return false;
  const end = subscription.state === "grace" ? subscription.graceEndsAt || subscription.validTo : subscription.validTo;
  return Date.parse(end) > at;
}

/** AI Tutor entitlement: a current subscription whose plan includes AI Tutor points (PC plans). */
export function hasAiTutor(data: ProductData, userId: string, at = Date.now(), plans: ProductPlan[] = withPlanAiPoints(data.plans)) {
  return data.subscriptions.some((item) => item.userId === userId && isCurrentSubscription(item, at) && (plans.find((plan) => plan.id === item.planId)?.aiPoints ?? 0) > 0);
}

export function isInactive(user: ProductUser) {
  return Boolean(user.deactivatedAt);
}

export type FeatureDecision = { enabled: boolean; reason: AccessReason; override: OverrideValue };

export function decideFeature(data: ProductData, user: ProductUser, feature: FeatureKey, at = Date.now(), plans?: ProductPlan[]): FeatureDecision {
  const override = overrideFor(data, user.id, feature);
  if (isInactive(user) || user.status !== "active") return { enabled: false, reason: "account_inactive", override };
  const global = globalSetting(data, feature);
  if (global.emergencyOff) return { enabled: false, reason: "emergency_off", override };
  if (FEATURE_CATALOGUE[feature].prerequisite === "ai_tutor" && !hasAiTutor(data, user.id, at, plans)) return { enabled: false, reason: "missing_prerequisite", override };
  if (override === "deny") return { enabled: false, reason: "override_deny", override };
  if (override === "allow") return { enabled: true, reason: "override_allow", override };
  return global.enabled ? { enabled: true, reason: "global_on", override } : { enabled: false, reason: "global_off", override };
}

export function decideAll(data: ProductData, user: ProductUser, at = Date.now()) {
  const plans = withPlanAiPoints(data.plans);
  return FEATURE_KEYS.map((feature) => ({ feature, ...decideFeature(data, user, feature, at, plans) }));
}

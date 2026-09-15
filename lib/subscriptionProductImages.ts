type SubscriptionPlanLike = {
  name?: string;
  scope?: string;
  scopeId?: string | null;
  category?: string | null;
} | null | undefined;

const subscriptionProductImages: Record<string, string> = {
  everything: "/portal/subscriptions/everything.png",
  "chinese humanities": "/portal/subscriptions/chinese_human.png",
  "european humanities": "/portal/subscriptions/european_human.png",
  science: "/portal/subscriptions/science.png",
};

function productKey(plan: SubscriptionPlanLike) {
  if (!plan) return null;
  if (plan.scope === "everything") return "everything";
  const label = plan.scopeId || plan.category || plan.name || "";
  const normalised = label.toLowerCase();
  if (normalised.includes("chinese humanities")) return "chinese humanities";
  if (normalised.includes("european humanities")) return "european humanities";
  if (normalised.includes("science")) return "science";
  if (normalised.includes("everything")) return "everything";
  return null;
}

export function localSubscriptionProductImage(plan: SubscriptionPlanLike) {
  const key = productKey(plan);
  return key ? subscriptionProductImages[key] || null : null;
}

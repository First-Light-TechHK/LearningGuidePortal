import type Stripe from "stripe";

export const stripePlanDefinitions = [
  { id: "everything-pc-6", env: "STRIPE_PRICE_EVERYTHING_SIX_MONTHS", months: 6, category: null },
  { id: "everything-pc-12", env: "STRIPE_PRICE_EVERYTHING_YEAR", months: 12, category: null },
  { id: "european-humanities-pc-6", env: "STRIPE_PRICE_CATE_EUROPEAN_HUMAN_SIX_MONTHS", months: 6, category: "European Humanities" },
  { id: "european-humanities-pc-12", env: "STRIPE_PRICE_CATE_EUROPEAN_HUMAN_YEAR", months: 12, category: "European Humanities" },
  { id: "chinese-humanities-pc-6", env: "STRIPE_PRICE_CATE_CHINESE_HUMAN_SIX_MONTHS", months: 6, category: "Chinese Humanities" },
  { id: "chinese-humanities-pc-12", env: "STRIPE_PRICE_CATE_CHINESE_HUMAN_YEAR", months: 12, category: "Chinese Humanities" },
  { id: "science-pc-6", env: "STRIPE_PRICE_CATE_SCIENCE_SIX_MONTHS", months: 6, category: "Science" },
  { id: "science-pc-12", env: "STRIPE_PRICE_CATE_SCIENCE_YEAR", months: 12, category: "Science" },
] as const;

export function configuredStripePrice(planId: string) {
  const definition = stripePlanDefinitions.find(plan => plan.id === planId);
  return definition ? process.env[definition.env]?.trim() : undefined;
}

export function validateStripePrice(price: Stripe.Price, expected: { months: number; amountMinor?: number; currency?: string }) {
  if (process.env.STRIPE_SANDBOX === "1" && price.livemode) throw new Error("Live prices are not allowed in this sandbox.");
  const months = price.recurring?.interval === "year" ? price.recurring.interval_count * 12
    : price.recurring?.interval === "month" ? price.recurring.interval_count : 0;
  if (!price.active || price.type !== "recurring" || price.recurring?.usage_type !== "licensed" || months !== expected.months) {
    throw new Error(`Stripe price ${price.id} must be active and recur every ${expected.months} months.`);
  }
  if (price.billing_scheme !== "per_unit" || price.unit_amount === null || !Number.isSafeInteger(price.unit_amount) || price.unit_amount < 0 || price.currency !== (expected.currency || "usd")) {
    throw new Error(`Stripe price ${price.id} has an unsupported amount or currency.`);
  }
  if (expected.amountMinor !== undefined && price.unit_amount !== expected.amountMinor) {
    throw new Error("The Stripe price has changed. Synchronise the catalogue and request a new quote before paying.");
  }
  return price;
}

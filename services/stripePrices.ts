import type Stripe from "stripe";

import { subscriptionPrices } from "@/contracts/payment";

export const stripePlanDefinitions = subscriptionPrices.map(plan => ({
  id: plan.id, env: plan.env, months: plan.termMonths,
  category: plan.scope === "everything" ? null : plan.scopeId,
}));

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
  if (price.billing_scheme !== "per_unit" || price.unit_amount === null || !Number.isSafeInteger(price.unit_amount) || price.unit_amount <= 0 || price.transform_quantity || price.currency !== (expected.currency || "usd")) {
    throw new Error(`Stripe price ${price.id} has an unsupported amount or currency.`);
  }
  if (expected.amountMinor !== undefined && price.unit_amount !== expected.amountMinor) {
    throw new Error("The Stripe price has changed. Synchronise the catalogue and request a new quote before paying.");
  }
  return price;
}

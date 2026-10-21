export type PlanPrice = { amountMinor: number; currency: string };

// Match Stripe Checkout: explicit currency and two decimals (US$39.00).
// Pin both fraction bounds to retain the BUG-0119 browser compatibility fix.
export function planPriceFormatOptions(plan: PlanPrice): Intl.NumberFormatOptions {
  return {
    style: "currency",
    currency: plan.currency.toUpperCase(),
    currencyDisplay: "symbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  };
}

export function formatPlanPrice(locale: string, plan: PlanPrice) {
  return new Intl.NumberFormat(locale, planPriceFormatOptions(plan)).format(plan.amountMinor / 100);
}

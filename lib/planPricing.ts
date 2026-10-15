export type PlanPrice = { amountMinor: number; currency: string };

// BUG-0119 (SIT, 小智双核浏览器): the pricing render used to pass only
// `maximumFractionDigits: plan.amountMinor % 100 ? 2 : 0` to a currency formatter.
// Engines that apply the currency's CLDR minor-unit default (2 for USD) for
// minimumFractionDigits before the range check threw
// `RangeError: maximumFractionDigits value is out of range` at `new NumberFormat`,
// which React surfaced as "Application error: a client-side exception" (QA console
// stack: new NumberFormat <- Array.map <- the pricing chunk). Pinning
// minimumFractionDigits to the same value keeps the display identical on modern
// engines ("$39" / "$39.50") and crash-free everywhere.
export function planPriceFormatOptions(plan: PlanPrice): Intl.NumberFormatOptions {
  const fractionDigits = plan.amountMinor % 100 ? 2 : 0;
  return {
    style: "currency",
    currency: plan.currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  };
}

export function formatPlanPrice(locale: string, plan: PlanPrice) {
  return new Intl.NumberFormat(locale, planPriceFormatOptions(plan)).format(plan.amountMinor / 100);
}

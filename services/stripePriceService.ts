import type Stripe from "stripe";
import { PaymentError, subscriptionPrices, type StripePriceSnapshot } from "@/contracts/payment";
import { validateStripePrice } from "./stripePrices";
import { getStripe } from "./stripeClient";

export function validateSubscriptionPrice(price: Stripe.Price, termMonths: 6 | 12): void {
  try { validateStripePrice(price, { months: termMonths }); } catch { throw new PaymentError("price_unavailable", 503); }
  const recurring = price.recurring;
  const months = recurring?.interval === "year" ? recurring.interval_count * 12 : recurring?.interval === "month" ? recurring.interval_count : 0;
  if (!price.active || price.type !== "recurring" || months !== termMonths || recurring?.usage_type !== "licensed"
    || price.currency !== "usd" || !Number.isSafeInteger(price.unit_amount) || (price.unit_amount ?? 0) <= 0
    || price.billing_scheme !== "per_unit" || price.transform_quantity) throw new PaymentError("price_unavailable", 503);
}

export async function resolveSubscriptionPrice(planId: string): Promise<StripePriceSnapshot> {
  const mapping = subscriptionPrices.find(item => item.id === planId);
  const lookupKey = mapping && process.env[mapping.env]?.trim();
  if (!mapping || !lookupKey) throw new PaymentError("price_unavailable", 503);
  try {
    const result = lookupKey.startsWith("price_") ? { data: [await getStripe().prices.retrieve(lookupKey, { expand: ["product"] })] } : await getStripe().prices.list({ lookup_keys: [lookupKey], active: true, limit: 2, expand: ["data.product"] });
    if (result.data.length !== 1) throw new PaymentError("price_unavailable", 503);
    const price = result.data[0];
    validateSubscriptionPrice(price, mapping.termMonths);
    return { stripePriceId: price.id, lookupKey, amountMinor: price.unit_amount!, currency: "usd", termMonths: mapping.termMonths, ...stripeProductPresentation(price) };
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    // Never expose provider URLs, request bodies or credentials to the browser.
    throw new PaymentError("price_unavailable", 503);
  }
}

export function stripeProductPresentation(price: Stripe.Price) {
  const product = price.product;
  if (!product || typeof product === "string" || product.deleted) return {};
  const productImage = product.images?.find(url => {
    try { return new URL(url).protocol === "https:"; } catch { return false; }
  }) || null;
  return { stripeProductId: product.id, productName: product.name, productImage };
}

// Historical orders predate product snapshots. Resolve their pinned Price, not today's plan.
export async function getHistoricalProductPresentation(priceId: string) {
  try {
    const price = await getStripe().prices.retrieve(priceId, { expand: ["product"] });
    return stripeProductPresentation(price);
  } catch { return {}; }
}

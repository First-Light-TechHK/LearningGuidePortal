export type StripePriceSnapshot = {
  stripePriceId: string;
  lookupKey: string;
  amountMinor: number;
  currency: "usd";
  termMonths: 6 | 12;
};

export const subscriptionPrices = [
  { id: "everything-pc-6", env: "STRIPE_PRICE_EVERYTHING_SIX_MONTHS", scope: "everything", scopeId: "*", termMonths: 6 },
  { id: "everything-pc-12", env: "STRIPE_PRICE_EVERYTHING_YEAR", scope: "everything", scopeId: "*", termMonths: 12 },
  { id: "european-humanities-pc-6", env: "STRIPE_PRICE_CATE_EUROPEAN_HUMAN_SIX_MONTHS", scope: "category", scopeId: "European Humanities", termMonths: 6 },
  { id: "european-humanities-pc-12", env: "STRIPE_PRICE_CATE_EUROPEAN_HUMAN_YEAR", scope: "category", scopeId: "European Humanities", termMonths: 12 },
  { id: "chinese-humanities-pc-6", env: "STRIPE_PRICE_CATE_CHINESE_HUMAN_SIX_MONTHS", scope: "category", scopeId: "Chinese Humanities", termMonths: 6 },
  { id: "chinese-humanities-pc-12", env: "STRIPE_PRICE_CATE_CHINESE_HUMAN_YEAR", scope: "category", scopeId: "Chinese Humanities", termMonths: 12 },
  { id: "science-pc-6", env: "STRIPE_PRICE_CATE_SCIENCE_SIX_MONTHS", scope: "category", scopeId: "Science", termMonths: 6 },
  { id: "science-pc-12", env: "STRIPE_PRICE_CATE_SCIENCE_YEAR", scope: "category", scopeId: "Science", termMonths: 12 },
] as const;

export class PaymentError extends Error {
  constructor(public readonly code: "price_unavailable" | "quote_expired" | "payment_unavailable" | "invalid_request", public readonly status = 400) {
    super(code);
  }
}

export type VerifiedStripeEvent = {
  id: string;
  type: string;
  action: "checkout" | "invoice" | "subscription" | "failed_checkout";
  orderId?: string;
  sessionId?: string;
  subscriptionId?: string;
  customerId?: string;
  paymentIntentId?: string;
  invoiceId?: string;
  amountMinor?: number;
  currency?: string;
  periodStart?: string;
  periodEnd?: string;
  status?: string;
  subscriptionStatus?: string;
  cancelAtPeriodEnd?: boolean;
  trial?: boolean;
  billingReason?: string | null;
};

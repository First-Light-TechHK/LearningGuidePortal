/** Existing Orders response projection; UI migration adds no endpoint or schema. */
export type BackofficeOrder = {
  id: string;
  userEmail: string;
  amountMinor: number;
  currency: string;
  status: "paid" | "pending" | "failed" | "canceled" | "refunded";
  paymentMode: "demo" | "stripe";
  createdAt: string;
  stripeCheckoutSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  lastStripeStatus?: string | null;
  lastSyncedAt?: string | null;
  exceptionCode?: string | null;
  failureReason?: string | null;
  plan: { name: string } | null;
  subscription?: { state: string; validTo: string } | null;
  activities?: Array<{ action: string; result: string; reason: string | null; createdAt: string }>;
};

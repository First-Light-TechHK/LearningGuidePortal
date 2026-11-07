export type OrderAction = "check" | "resume" | "cancel";
export type PaymentReviewState = "unverified" | "awaiting_payment" | "processing" | "synchronising" | "unavailable";
export type PaymentReview = {
  state: PaymentReviewState;
  checkedAt: string;
  expiresAt: string | null;
  providerStatus: string | null;
  reason: "provider_unavailable" | "identity_mismatch" | "missing_payment" | "fulfilment_pending" | null;
};
/** Account-owned projection: provider identities, URLs and user details stay server-side. */
export type ManagedOrder = {
  id: string;
  name: string;
  kind: "purchase" | "trial_activation" | "upgrade";
  status: "pending" | "paid" | "failed" | "canceled" | "refunded";
  state: PaymentReviewState | "paid" | "failed" | "canceled" | "expired" | "refunded";
  amountMinor: number;
  currency: string;
  termMonths: number | null;
  createdAt: string;
  expiresAt: string | null;
  checkedAt: string | null;
  reason: PaymentReview["reason"];
  canResume: boolean;
  canCancel: boolean;
};
export type OrderActionResult = { order: ManagedOrder; checkoutUrl?: string };
export type OrderManagementErrorCode = "invalid_request" | "not_found" | "unauthenticated" | "forbidden" | "forbidden_origin" | "payment_unavailable";
export class OrderManagementError extends Error {
  constructor(public readonly code: OrderManagementErrorCode, public readonly status: number) { super(code); }
}
export function parseOrderAction(value: unknown): { action: OrderAction } {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => key !== "action")
    || typeof (value as { action?: unknown }).action !== "string"
    || !["check", "resume", "cancel"].includes((value as { action: string }).action)) {
    throw new OrderManagementError("invalid_request", 400);
  }
  return value as { action: OrderAction };
}

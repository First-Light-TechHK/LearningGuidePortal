/**
 * PAY-01..07 stay Blocked until the Stripe payment process is actually finished.
 * Store / demo green is not a pass. Flip PAYMENT_PROCESS_COMPLETE only after
 * the Stripe path + these invariants are done, then re-run without skip.
 *
 * Do not print secret values.
 */

export const PAY_BLOCKED_IDS = ["PAY-01", "PAY-02", "PAY-03", "PAY-04", "PAY-05", "PAY-06", "PAY-07"] as const;

export type PayBlockedId = (typeof PAY_BLOCKED_IDS)[number];

/** Lift only when Stripe checkout/webhook + PAY-01..07 invariants are done. */
export const PAYMENT_PROCESS_COMPLETE = false;

export const PAY_BLOCKED_UNTIL_DONE = "支付过程开发未完成，完成后再解除";

export function hasStripeTestKey(): boolean {
  const key = (process.env.STRIPE_SECRET_KEY || "").trim();
  return key.startsWith("sk_test_");
}

/** node:test / Playwright skip reason, or false when the strict body may run. */
export function payBlockedSkip(id: PayBlockedId): string | false {
  if (!PAYMENT_PROCESS_COMPLETE) {
    return `Blocked: ${id} ${PAY_BLOCKED_UNTIL_DONE}`;
  }
  if (!hasStripeTestKey()) {
    return `Blocked: no Stripe test key`;
  }
  return false;
}

/** EX-009 / PAY-05: JSON stripeEvents[] is not a table UNIQUE. */
export function stripeEventsHaveTableUnique(): boolean {
  return false;
}

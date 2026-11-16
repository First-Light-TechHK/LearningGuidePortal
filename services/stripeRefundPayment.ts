import type Stripe from "stripe";
import { applyVerifiedStripeEvent, readProductData } from "./productStore";
import { getStripe } from "./stripeClient";

const identity = (value: string | { id: string } | null) => typeof value === "string" ? value : value?.id;

/** Signed events are a trigger; only current successful provider refunds change access. */
export async function reconcileStripeRefund(event: Stripe.Event) {
  const stripe = getStripe();
  let chargeId: string | undefined;
  if (event.type === "charge.refunded") chargeId = (event.data.object as Stripe.Charge).id;
  else {
    const refund = await stripe.refunds.retrieve((event.data.object as Stripe.Refund).id);
    chargeId = identity(refund.charge);
  }
  if (!chargeId) throw new Error("Refund charge unavailable.");
  const charge = await stripe.charges.retrieve(chargeId);
  if (charge.id !== chargeId || process.env.STRIPE_SANDBOX === "1" && charge.livemode) throw new Error("Refund charge mismatch.");
  const paymentIntentId = identity(charge.payment_intent);
  if (!paymentIntentId) throw new Error("Refund payment unavailable.");
  const orders = (await readProductData()).orders.filter(order => order.paymentMode === "stripe" && order.stripePaymentIntentId === paymentIntentId);
  // An Invoice/Checkout may still be in flight; do not acknowledge and lose its refund.
  if (orders.length !== 1) throw new Error("Refund order not available yet.");
  let refundedAmountMinor = 0, cursor: string | undefined;
  for (;;) {
    const page = await stripe.refunds.list({ charge: chargeId, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
    for (const refund of page.data) {
      if (identity(refund.charge) !== chargeId || refund.currency !== charge.currency || !Number.isSafeInteger(refund.amount) || refund.amount < 0) throw new Error("Refund identity mismatch.");
      if (refund.status === "succeeded") refundedAmountMinor += refund.amount;
    }
    if (!page.has_more) break;
    const next = page.data.at(-1)?.id;
    if (!next || next === cursor) throw new Error("Refund page unavailable.");
    cursor = next;
  }
  return applyVerifiedStripeEvent({ id: event.id, type: event.type, action: "refund", orderId: orders[0].id,
    paymentIntentId, chargeId, amountMinor: charge.amount, currency: charge.currency, refundedAmountMinor });
}

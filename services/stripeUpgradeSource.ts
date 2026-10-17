import { PaymentError } from "@/contracts/payment";
import type { LegacyStripeUpgradeSource } from "@/contracts/stripe-upgrade";
import { getStripe } from "./stripeClient";
import { stripeIdentity } from "./stripeUpgradeProration";

// Older paid Orders can predate Price snapshots. Read the exact original
// Checkout; never substitute today's category Price or rewrite payment history.
export async function resolveLegacyUpgradeSourcePrice(input: LegacyStripeUpgradeSource) {
  try {
    const session = await getStripe().checkout.sessions.retrieve(input.checkoutSessionId, { expand: ["line_items.data.price"] });
    const metadata = session.metadata;
    const lines = session.line_items;
    const price = lines?.data[0]?.price;
    if (session.id !== input.checkoutSessionId || session.mode !== "subscription" || session.status !== "complete" || session.payment_status !== "paid"
      || stripeIdentity(session.subscription) !== input.subscriptionId || stripeIdentity(session.customer) !== input.customerId
      || session.amount_total !== input.amountMinor || session.currency !== input.currency
      || metadata?.app !== "learning_guide" || metadata.userId !== input.userId || metadata.planId !== input.planId || metadata.orderId !== input.orderId
      || !lines || lines.has_more || lines.data.length !== 1 || lines.data[0].quantity !== 1 || !price?.id) {
      throw new PaymentError("payment_unavailable", 503, "upgrade_checkout_mismatch");
    }
    // previewStripeUpgrade verifies this pinned Price against the current item,
    // original customer, paid status, interval and unchanged period before quoting.
    return price.id;
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError("payment_unavailable", 503, "upgrade_checkout_unavailable");
  }
}

import type Stripe from "stripe";
import { PaymentError, type StripePriceSnapshot } from "@/contracts/payment";
import type { StripeUpgradeCredit } from "@/contracts/stripe-upgrade";
import { getStripe } from "./stripeClient";
import { validateSubscriptionPrice } from "./stripePriceService";
import { stripeIdentity } from "./stripeUpgradeProration";

export function validateUpgradeCoupon(coupon: Stripe.Coupon, months: 6 | 12, productId: string) {
  if (!coupon.valid || coupon.duration !== "once" || coupon.currency !== "usd" || coupon.percent_off !== null
    || coupon.amount_off !== (months === 6 ? 3900 : 7800) || !coupon.applies_to?.products?.includes(productId)
    || process.env.STRIPE_SANDBOX === "1" && coupon.livemode) throw new PaymentError("price_unavailable", 503);
}

export async function resolveUpgradeCredit(input: { sourceOrderId: string; subscriptionId: string; customerId: string; sourcePriceId: string; paidAmountMinor: number; price: StripePriceSnapshot }): Promise<StripeUpgradeCredit> {
  const { price } = input, stripe = getStripe();
  const couponId = process.env[price.termMonths === 6 ? "STRIPE_COUPON_UPGRADE_SIX_MONTHS" : "STRIPE_COUPON_UPGRADE_ONE_YEAR"]?.trim();
  if (!couponId) throw new PaymentError("price_unavailable", 503);
  try {
    const target = await stripe.prices.retrieve(price.stripePriceId);
    validateSubscriptionPrice(target, price.termMonths);
    const productId = stripeIdentity(target.product);
    if (!productId || target.unit_amount !== (price.termMonths === 6 ? 9900 : 19800) || target.unit_amount !== price.amountMinor) throw new PaymentError("price_unavailable", 503);
    const coupon = await stripe.coupons.retrieve(couponId, { expand: ["applies_to"] });
    validateUpgradeCoupon(coupon, price.termMonths, productId);
    const source = await stripe.subscriptions.retrieve(input.subscriptionId, { expand: ["latest_invoice"] });
    const item = source.items.data[0];
    const latest = typeof source.latest_invoice === "string" ? await stripe.invoices.retrieve(source.latest_invoice) : source.latest_invoice;
    if (source.id !== input.subscriptionId || stripeIdentity(source.customer) !== input.customerId || source.status !== "active"
      || source.cancel_at_period_end || source.pending_update || source.schedule || source.pause_collection || source.collection_method !== "charge_automatically"
      || source.items.data.length !== 1 || !item || item.quantity !== 1 || item.price.id !== input.sourcePriceId || latest?.status !== "paid"
      || process.env.STRIPE_SANDBOX === "1" && source.livemode) throw new PaymentError("upgrade_unavailable");
    validateSubscriptionPrice(item.price, price.termMonths);
    const creditMinor = price.termMonths === 6 ? 3900 : 7800;
    if (item.price.unit_amount !== creditMinor || input.paidAmountMinor !== creditMinor || item.current_period_end <= Date.now() / 1000) throw new PaymentError("upgrade_unavailable");
    return { strategy: "new_subscription_credit", sourceOrderId: input.sourceOrderId, sourceStripeSubscriptionId: source.id,
      customerId: input.customerId, sourcePriceId: item.price.id, sourcePeriodEnd: item.current_period_end,
      couponId: coupon.id, productId, listAmountMinor: price.amountMinor, creditMinor, amountDueMinor: price.amountMinor - creditMinor };
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError("payment_unavailable", 503);
  }
}

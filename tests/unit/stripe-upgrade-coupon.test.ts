import assert from "node:assert/strict";
import { test } from "node:test";
import type Stripe from "stripe";
import { validateUpgradeCoupon } from "../../services/stripeUpgradeCreditPrice";

test("upgrade Coupons must be fixed USD credit, once, valid and restricted to the target product", () => {
  const coupon = { id: "coupon_test", valid: true, duration: "once", currency: "usd", percent_off: null,
    amount_off: 3900, applies_to: { products: ["prod_everything"] } } as Stripe.Coupon;
  assert.doesNotThrow(() => validateUpgradeCoupon(coupon, 6, "prod_everything"));
  assert.doesNotThrow(() => validateUpgradeCoupon({ ...coupon, amount_off: 7800 }, 12, "prod_everything"));
  for (const patch of [{ valid: false }, { duration: "forever" }, { percent_off: 50 }, { amount_off: 7800 },
    { currency: "gbp" }, { applies_to: { products: ["prod_category"] } }, { applies_to: undefined }]) {
    assert.throws(() => validateUpgradeCoupon({ ...coupon, ...patch } as Stripe.Coupon, 6, "prod_everything"));
  }
});

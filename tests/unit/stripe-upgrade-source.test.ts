import assert from "node:assert/strict";
import { test } from "node:test";
import { PaymentError } from "../../contracts/payment";
import { resolveLegacyUpgradeSourcePrice } from "../../services/stripeUpgradeSource";
import { getStripe } from "../../services/stripeClient";
import { paymentFailure } from "../../services/paymentHttp";

test("legacy upgrade Prices require the original paid Checkout, ownership, amount and one complete item", async () => {
  const environment = { ...process.env };
  Object.assign(process.env, { STRIPE_SECRET_KEY: "sk_test_fake_only", STRIPE_SANDBOX: "1" });
  const stripe = getStripe(), retrieve = stripe.checkout.sessions.retrieve;
  const input = { checkoutSessionId: "cs_original", orderId: "order_owner", userId: "owner", planId: "science-pc-6", subscriptionId: "sub_owner", customerId: "cus_owner", amountMinor: 3900, currency: "usd" };
  const baseline = { id: input.checkoutSessionId, mode: "subscription", status: "complete", payment_status: "paid", subscription: input.subscriptionId, customer: input.customerId, currency: "usd", amount_total: 3900,
    metadata: { app: "learning_guide", userId: input.userId, orderId: input.orderId, planId: input.planId },
    line_items: { has_more: false, data: [{ quantity: 1, price: { id: "price_original_archived" } }] } };
  let session: any = structuredClone(baseline), fail = false;
  stripe.checkout.sessions.retrieve = (async (id: string, params: unknown) => {
    assert.equal(id, input.checkoutSessionId);
    assert.deepEqual(params, { expand: ["line_items.data.price"] });
    if (fail) throw new Error("Provider URL, customer email and credentials must stay private");
    return session;
  }) as typeof stripe.checkout.sessions.retrieve;
  try {
    assert.equal(await resolveLegacyUpgradeSourcePrice(input), "price_original_archived");
    session = { ...structuredClone(baseline), customer: { id: input.customerId }, subscription: { id: input.subscriptionId } };
    assert.equal(await resolveLegacyUpgradeSourcePrice(input), "price_original_archived");
    const invalid = [
      { id: "cs_other" }, { mode: "payment" }, { status: "open" }, { payment_status: "unpaid" }, { subscription: "sub_other" }, { customer: "cus_other" },
      { currency: "eur" }, { amount_total: 3901 }, { metadata: null }, { metadata: { ...baseline.metadata, userId: "other" } },
      { metadata: { ...baseline.metadata, orderId: "order_other" } }, { metadata: { ...baseline.metadata, planId: "everything-pc-6" } },
      { metadata: { ...baseline.metadata, app: "other" } }, { line_items: undefined }, { line_items: { ...baseline.line_items, has_more: true } },
      { line_items: { has_more: false, data: [] } }, { line_items: { has_more: false, data: [...baseline.line_items.data, ...baseline.line_items.data] } },
      { line_items: { has_more: false, data: [{ quantity: 2, price: { id: "price_original" } }] } },
      { line_items: { has_more: false, data: [{ quantity: 1, price: null }] } },
    ];
    for (const patch of invalid) {
      session = { ...structuredClone(baseline), ...patch };
      await assert.rejects(resolveLegacyUpgradeSourcePrice(input), error => error instanceof PaymentError && error.code === "payment_unavailable" && error.diagnosticReason === "upgrade_checkout_mismatch");
    }
    fail = true;
    await assert.rejects(resolveLegacyUpgradeSourcePrice(input), error => error instanceof PaymentError && error.diagnosticReason === "upgrade_checkout_unavailable");
  } finally { stripe.checkout.sessions.retrieve = retrieve; process.env = environment; }
});

test("server diagnostics correlate the public requestId without exposing payment identities or raw errors", async () => {
  const logged: string[] = [], original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.join(" ")); };
  try {
    for (const error of [new PaymentError("payment_unavailable", 503, "upgrade_checkout_missing"), new Error("password=secret email=private@example.test sk_test_sensitive")]) {
      const response = paymentFailure(error);
      const body = await response.json();
      const event = JSON.parse(logged.at(-1)!);
      assert.equal(event.requestId, body.requestId);
      assert.equal(event.code, body.code);
      assert.equal(event.status, response.status);
      assert.equal(event.reason, error instanceof PaymentError ? "upgrade_checkout_missing" : "unexpected_payment_error");
      assert.equal("reason" in body, false);
      assert.doesNotMatch(JSON.stringify(body) + JSON.stringify(event), /secret|private@example|sk_test_sensitive/);
      assert.deepEqual(Object.keys(event).sort(), ["event", "requestId", "code", "status", "reason"].sort());
    }
  } finally { console.error = original; }
});

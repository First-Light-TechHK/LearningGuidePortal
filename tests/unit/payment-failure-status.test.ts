import assert from "node:assert/strict";
import { test } from "node:test";
import { paymentFailure } from "../../services/paymentHttp";
import { POST as checkEmail } from "../../app/api/auth/check-email/route";

test("client-owned payment mistakes are 400; unknown provider failures stay 502", async () => {
  const client = [
    "This plan already has active access.",
    "Plan not found.",
    "The three-day trial has ended.",
    "This trial payment attempt cannot be completed.",
    "Only an active PC category subscription can be upgraded.",
    "This quote has expired. Please calculate the price again.",
    "This subscription cannot be resumed.",
    "Auto-renewal cannot be restored. You can purchase a new plan after the current period ends.",
  ];
  for (const message of client) {
    const response = paymentFailure(new Error(message));
    assert.equal(response.status, 400, message);
    assert.equal((await response.json()).code, "invalid_request");
  }
  const provider = paymentFailure(new Error("Stripe timed out"));
  assert.equal(provider.status, 502);
  assert.equal((await provider.json()).code, "payment_unavailable");
});

test("check-email never reports whether an address exists", async () => {
  const known = await checkEmail(new Request("http://localhost/api/auth/check-email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "known@example.test" }),
  }));
  const unknown = await checkEmail(new Request("http://localhost/api/auth/check-email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "unknown@example.test" }),
  }));
  assert.deepEqual(await known.json(), { ok: true });
  assert.deepEqual(await unknown.json(), { ok: true });
});

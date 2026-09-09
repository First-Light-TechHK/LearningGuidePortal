import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { payBlockedSkip } from "./pay-strict-blocked";

// PAY-06 Blocked: 支付过程开发未完成，完成后再解除.
// SUB-FR-021 / BR-012: grace is original expiry + 3 days, not now+3d.
// Break: markStripeSubscriptionGrace writing validTo / graceEndsAt as now+3 days.

const PLAN_ID = "epicureanism-pc-6";
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-pay-06-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  store = await import("../../services/productStore");
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) {
    await rm(isolatedCwd, { recursive: true, force: true });
  }
});

test(
  "PAY-06: grace D+3 must be from the original expiry, not now+3 days",
  { skip: payBlockedSkip("PAY-06") },
  async () => {
    const user = await store.registerUser({
      email: "pay-06-grace@example.test",
      password: "password1",
      nickname: "Pay Six",
    });
    await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
    const quote = await store.createQuote(user.id, PLAN_ID);
    await store.createPendingStripeOrder(user.id, quote.quote.id);
    await store.fulfilStripeCheckout({
      eventId: "evt_pay06",
      eventType: "checkout.session.completed",
      sessionId: "cs_pay06",
      userId: user.id,
      quoteId: quote.quote.id,
      planId: PLAN_ID,
      subscriptionId: "sub_pay06",
    });

    const before = (await store.ensureProductData()).subscriptions.find(
      (item) => item.stripeSubscriptionId === "sub_pay06",
    );
    assert.ok(before);
    const originalValidTo = before.validTo;
    const originalMs = Date.parse(originalValidTo);
    assert.ok(originalMs - Date.now() > 30 * 24 * 60 * 60 * 1000);

    const graced = await store.markStripeSubscriptionGrace("sub_pay06");
    assert.ok(graced);
    assert.equal(graced.validTo, originalValidTo, "must not shorten an already-paid validTo");
    assert.ok(graced.graceEndsAt, "graceEndsAt is recorded");
    const graceMs = Date.parse(graced.graceEndsAt);
    assert.ok(Number.isFinite(graceMs));
    assert.ok(
      Math.abs(graceMs - (originalMs + THREE_DAYS_MS)) < 60_000,
      "SUB-FR-021 / BR-012: graceEndsAt is original expiry + 3 days, not now+3 days",
    );
  },
);

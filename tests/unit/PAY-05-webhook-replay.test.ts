import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { payBlockedSkip, stripeEventsHaveTableUnique } from "./pay-strict-blocked";

// PAY-05 Blocked: 支付过程开发未完成，完成后再解除.
// EX-009: duplicate success events must not fulfil twice.
// Need table UNIQUE on stripe_events (or claim-after). JSON array is not UNIQUE.

const PLAN_ID = "epicureanism-pc-6";
const COURSE_ID = "epicureanism";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-pay-05-"));
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
  "PAY-05: duplicate success events must not fulfil twice; stripe_events UNIQUE required",
  { skip: payBlockedSkip("PAY-05") },
  async () => {
    assert.equal(
      stripeEventsHaveTableUnique(),
      true,
      "EX-009: stripe_events must have table-level UNIQUE; product.json stripeEvents[] / in-process claim is not enough",
    );

    const user = await store.registerUser({
      email: "pay-05-replay@example.test",
      password: "password1",
      nickname: "Pay Five",
    });
    await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
    const quote = await store.createQuote(user.id, PLAN_ID);
    await store.createPendingStripeOrder(user.id, quote.quote.id);
    const input = {
      eventId: "evt_pay05_same",
      eventType: "checkout.session.completed",
      sessionId: "cs_pay05",
      userId: user.id,
      quoteId: quote.quote.id,
      planId: PLAN_ID,
      subscriptionId: "sub_pay05",
    };
    const first = await store.fulfilStripeCheckout(input);
    const second = await store.fulfilStripeCheckout(input);
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    const entitlements = (await store.ensureProductData()).entitlements.filter(
      (item) => item.userId === user.id && item.state === "active",
    );
    assert.equal(entitlements.length, 1);
    assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, true);
  },
);

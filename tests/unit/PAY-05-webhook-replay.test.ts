import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Store lock for PAY-05 replay. Table-level UNIQUE is still missing — do not Closed.

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

test("PAY-05 store: replaying the same event.id must not grant twice", async () => {
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
  const entitlements = (await store.ensureProductData()).entitlements.filter((item) => item.userId === user.id && item.state === "active");
  assert.equal(entitlements.length, 1);
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, true);
});

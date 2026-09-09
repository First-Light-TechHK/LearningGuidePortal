import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Store lock for PAY-04. Does not claim Stripe E2E Closed.
// Break: applyStripePaidInvoice reviving a refunded / expired purchase.

const PLAN_ID = "epicureanism-pc-6";
const COURSE_ID = "epicureanism";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-pay-04-"));
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

test("PAY-04 store: a later invoice.paid must not revive a refunded purchase", async () => {
  const user = await store.registerUser({
    email: "pay-04-revive@example.test",
    password: "password1",
    nickname: "Pay Four",
  });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  const quote = await store.createQuote(user.id, PLAN_ID);
  const pending = await store.createPendingStripeOrder(user.id, quote.quote.id);
  await store.fulfilStripeCheckout({
    eventId: "evt_pay04",
    eventType: "checkout.session.completed",
    sessionId: "cs_pay04",
    userId: user.id,
    quoteId: quote.quote.id,
    planId: PLAN_ID,
    subscriptionId: "sub_pay04",
  });
  await store.refundOrder(pending.order.id, "operator");
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, false);

  await store.applyStripePaidInvoice({
    subscriptionId: "sub_pay04",
    invoiceId: "in_pay04_after_refund",
    amountMinor: 4900,
  });
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, false);
  const subscription = (await store.ensureProductData()).subscriptions.find((item) => item.stripeSubscriptionId === "sub_pay04");
  assert.ok(subscription);
  assert.notEqual(subscription.state, "active");
});

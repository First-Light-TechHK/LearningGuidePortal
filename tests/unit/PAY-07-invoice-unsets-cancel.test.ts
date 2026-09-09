import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Store lock for PAY-07. Does not claim Stripe E2E Closed.
// Break: applyStripePaidInvoice clearing cancelAtPeriodEnd.

const PLAN_ID = "epicureanism-pc-6";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-pay-07-"));
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

test("PAY-07 store: invoice.paid must not clear cancel_at_period_end", async () => {
  const user = await store.registerUser({
    email: "pay-07-cancel@example.test",
    password: "password1",
    nickname: "Pay Seven",
  });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  const quote = await store.createQuote(user.id, PLAN_ID);
  await store.createPendingStripeOrder(user.id, quote.quote.id);
  await store.fulfilStripeCheckout({
    eventId: "evt_pay07",
    eventType: "checkout.session.completed",
    sessionId: "cs_pay07",
    userId: user.id,
    quoteId: quote.quote.id,
    planId: PLAN_ID,
    subscriptionId: "sub_pay07",
  });

  const current = (await store.ensureProductData()).subscriptions.find((item) => item.stripeSubscriptionId === "sub_pay07");
  assert.ok(current);
  await store.cancelSubscription(user.id, current.id);
  const canceled = (await store.ensureProductData()).subscriptions.find((item) => item.id === current.id);
  assert.equal(canceled?.cancelAtPeriodEnd, true);
  assert.equal(canceled?.state, "cancel_at_period_end");

  await store.applyStripePaidInvoice({
    subscriptionId: "sub_pay07",
    invoiceId: "in_pay07_renew",
    amountMinor: 4900,
    currentPeriodStart: canceled!.validFrom,
    currentPeriodEnd: canceled!.validTo,
  });

  const after = (await store.ensureProductData()).subscriptions.find((item) => item.id === current.id);
  assert.ok(after);
  assert.equal(after.cancelAtPeriodEnd, true);
  assert.equal(after.state, "cancel_at_period_end");
});

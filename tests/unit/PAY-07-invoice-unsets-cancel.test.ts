import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { payBlockedSkip } from "./pay-strict-blocked";

// PAY-07 Blocked: 支付过程开发未完成，完成后再解除.
// Paid cancel has no Resume; invoice.paid must not clear cancel_at_period_end.

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

test(
  "PAY-07: invoice.paid must not clear cancel_at_period_end or allow resume",
  { skip: payBlockedSkip("PAY-07") },
  async () => {
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

    const current = (await store.ensureProductData()).subscriptions.find(
      (item) => item.stripeSubscriptionId === "sub_pay07",
    );
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
    await assert.rejects(
      () => store.resumeSubscription(user.id, current.id),
      /cannot be restored|cannot be resumed/,
    );
  },
);

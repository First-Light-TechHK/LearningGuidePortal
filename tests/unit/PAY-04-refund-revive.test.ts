import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { payBlockedSkip } from "./pay-strict-blocked";

// PAY-04 Blocked: 支付过程开发未完成，完成后再解除.
// EX-011 / SUB-FR-023: refund must kill entitlement immediately;
// a later invoice.paid must not revive. refundOrder still does not cancel Stripe.

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

test(
  "PAY-04: refund must terminate entitlement immediately; later invoice must not revive",
  { skip: payBlockedSkip("PAY-04") },
  async () => {
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

    const afterRefund = await store.checkEntitlement(user.id, COURSE_ID);
    assert.equal(afterRefund.allowed, false, "entitlement must die immediately on refund");
    const revoked = (await store.ensureProductData()).entitlements.find(
      (item) => item.userId === user.id && item.source === "purchase",
    );
    assert.ok(revoked);
    assert.equal(revoked.state, "revoked");

    await store.applyStripePaidInvoice({
      subscriptionId: "sub_pay04",
      invoiceId: "in_pay04_after_refund",
      amountMinor: 4900,
    });
    assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, false);
    const subscription = (await store.ensureProductData()).subscriptions.find(
      (item) => item.stripeSubscriptionId === "sub_pay04",
    );
    assert.ok(subscription);
    assert.notEqual(subscription.state, "active", "later invoice.paid must not revive a refunded purchase");
  },
);

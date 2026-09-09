import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { payBlockedSkip } from "./pay-strict-blocked";

// PAY-01 Blocked: 支付过程开发未完成，完成后再解除.
// Sub v1.6 has no $0 / trial / invoice object — do not merge UC-VISITOR 20/40,
// clone 3-day $0 trial, and this invoice.paid path into one story.
// Break: convertStripeTrial($0 invoice.paid) writing a full-term purchase.

const PLAN_ID = "epicureanism-pc-6";
const COURSE_ID = "epicureanism";
const TRIAL_MS = 3 * 24 * 60 * 60 * 1000;
const SIX_MONTHS_MS = 150 * 24 * 60 * 60 * 1000;

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-pay-01-"));
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
  "PAY-01: $0 trial invoice.paid must not grant a full paid period",
  { skip: payBlockedSkip("PAY-01") },
  async () => {
    const user = await store.registerUser({
      email: "pay-01-zero@example.test",
      password: "password1",
      nickname: "Pay One",
    });
    await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
    const quote = await store.createQuote(user.id, PLAN_ID, "trial");
    const pending = await store.createPendingStripeTrialOrderFromQuote(user.id, quote.quote.id);
    await store.activateStripeTrial({
      eventId: "evt_pay01_checkout",
      eventType: "checkout.session.completed",
      orderId: pending.order.id,
      sessionId: "cs_pay01",
      subscriptionId: "sub_pay01",
      customerId: "cus_pay01",
    });

    const before = Date.now();
    const converted = await store.convertStripeTrial({
      subscriptionId: "sub_pay01",
      invoiceId: "in_pay01_zero",
      amountMinor: 0,
    });
    assert.equal(converted, null, "a $0 invoice must not convert the trial into a paid term");

    const check = await store.checkEntitlement(user.id, COURSE_ID);
    assert.equal(check.allowed, true);
    assert.equal(check.source, "trial");
    const validTo = Date.parse(check.validTo || "");
    assert.ok(Number.isFinite(validTo));
    assert.ok(validTo <= before + TRIAL_MS + 60_000, "validTo must stay inside the 3-day trial window");
    assert.ok(validTo < before + SIX_MONTHS_MS, "validTo must not jump to a 6-month purchase");

    const paid = (await store.ensureProductData()).subscriptions.filter(
      (item) => item.userId === user.id && item.source === "purchase" && item.stripeSubscriptionId === "sub_pay01",
    );
    assert.equal(paid.length, 0, "no purchase subscription from a $0 invoice.paid");
  },
);

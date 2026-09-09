import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { payBlockedSkip } from "./pay-strict-blocked";

// PAY-02 Blocked: 支付过程开发未完成，完成后再解除.
// SUB-FR-017 / BR-015: upgrade must stop source Stripe auto-renew.
// Today fulfilUpgrade only expires the local row; createHostedUpgradeCheckout is mode=payment.
// Local expire is not proof.

const SOURCE_PLAN = "european-humanities-pc-6";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-pay-02-"));
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
  "PAY-02: upgrade must cancel the source Stripe subscription, not only expire the local row",
  { skip: payBlockedSkip("PAY-02") },
  async () => {
    const user = await store.registerUser({
      email: "pay-02-orphan@example.test",
      password: "password1",
      nickname: "Pay Two",
    });
    await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
    const quote = await store.createQuote(user.id, SOURCE_PLAN);
    await store.createPendingStripeOrder(user.id, quote.quote.id);
    await store.fulfilStripeCheckout({
      eventId: "evt_pay02_source",
      eventType: "checkout.session.completed",
      sessionId: "cs_pay02_source",
      userId: user.id,
      quoteId: quote.quote.id,
      planId: SOURCE_PLAN,
      subscriptionId: "sub_pay02_source",
    });

    const sourceBefore = (await store.ensureProductData()).subscriptions.find(
      (item) => item.stripeSubscriptionId === "sub_pay02_source",
    );
    assert.ok(sourceBefore);

    const upgrade = await store.createUpgradeQuote(user.id, sourceBefore.id);
    const pending = await store.createPendingStripeUpgradeOrderFromQuote(user.id, upgrade.quote.id);
    await store.completeStripeUpgradeOrder(user.id, pending.order.id);

    const sourceAfter = (await store.ensureProductData()).subscriptions.find((item) => item.id === sourceBefore.id);
    assert.ok(sourceAfter);
    assert.equal(sourceAfter.stripeSubscriptionId, "sub_pay02_source", "source Stripe id must still be known");
    assert.equal(
      (sourceAfter as { stripeCancelIssued?: boolean }).stripeCancelIssued,
      true,
      "SUB-FR-017: upgrade must issue Stripe cancel on the source subscription; local expire is not PAY-02 proof",
    );
  },
);

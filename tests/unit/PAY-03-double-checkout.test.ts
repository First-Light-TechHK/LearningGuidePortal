import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { payBlockedSkip } from "./pay-strict-blocked";

// PAY-03 Blocked: 支付过程开发未完成，完成后再解除.
// SUB-FR-008 / EX-003: same quote must reuse the payable Session.
// attachStripeCheckoutSession keeping the first id is not enough if checkout
// still calls sessions.create and leaves a second payable Session.

const PLAN_ID = "epicureanism-pc-6";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-pay-03-"));
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
  "PAY-03: same quote must reuse one Session, not create many Stripe sessions",
  { skip: payBlockedSkip("PAY-03") },
  async () => {
    const user = await store.registerUser({
      email: "pay-03-double@example.test",
      password: "password1",
      nickname: "Pay Three",
    });
    await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
    const quote = await store.createQuote(user.id, PLAN_ID);
    const pending = await store.createPendingStripeOrder(user.id, quote.quote.id);
    await store.attachStripeCheckoutSession(user.id, pending.order.id, "cs_first");
    await store.attachStripeCheckoutSession(user.id, pending.order.id, "cs_second");
    const order = await store.getOrderForUser(user.id, pending.order.id);
    assert.equal(order?.stripeCheckoutSessionId, "cs_first", "second attach must not replace the unpaid session");

    const createdSecondPayableSession = true;
    assert.equal(
      createdSecondPayableSession,
      false,
      "SUB-FR-008 / EX-003: checkout must reuse the existing Session; must not sessions.create a second payable Session for the same quote",
    );
  },
);

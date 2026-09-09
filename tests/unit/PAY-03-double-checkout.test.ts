import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Store lock for PAY-03. Does not claim Stripe E2E Closed.
// Break: attachStripeCheckoutSession overwriting a session that can still be paid.

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

test("PAY-03 store: a second checkout session must not replace the first unpaid session", async () => {
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
  assert.equal(order?.stripeCheckoutSessionId, "cs_first");
});

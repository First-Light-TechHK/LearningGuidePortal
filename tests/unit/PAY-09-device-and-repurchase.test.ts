import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Break: checkEntitlement ignores device; same plan can be quoted again (PAY-09).

const PLAN_ID = "epicureanism-pc-6";
const COURSE_ID = "epicureanism";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-pay-09-"));
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

async function purchasedUser(email: string) {
  const user = await store.registerUser({ email, password: "password1", nickname: "Pay Nine" });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  const quote = await store.createQuote(user.id, PLAN_ID);
  const pending = await store.createPendingDemoOrder(user.id, quote.quote.id);
  await store.completeDemoOrder(user.id, pending.order.id);
  return user;
}

test("PAY-09: PC entitlement does not allow a mobile device check", async () => {
  const user = await purchasedUser("pay-09-device@example.test");
  const pc = await store.checkEntitlement(user.id, COURSE_ID, "pc");
  const mobile = await store.checkEntitlement(user.id, COURSE_ID, "mobile");
  assert.equal(pc.allowed, true);
  assert.equal(mobile.allowed, false);
});

test("PAY-09: the same plan cannot be quoted again while access is active", async () => {
  const user = await purchasedUser("pay-09-repurchase@example.test");
  await assert.rejects(
    () => store.createQuote(user.id, PLAN_ID, "purchase"),
    /already has active access/,
  );
});

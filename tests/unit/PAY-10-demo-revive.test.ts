import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Break: completeDemoTrialOrder on an already-paid order after trial cancel
// would revive the entitlement (PAY-10 / API-PAY-007).

const PLAN_ID = "epicureanism-pc-6";
const COURSE_ID = "epicureanism";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-pay-10-"));
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

test("PAY-10: second complete on a paid demo trial after cancel must not revive access", async () => {
  const user = await store.registerUser({
    email: "pay-10-revive@example.test",
    password: "password1",
    nickname: "Pay Ten",
  });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));

  const pending = await store.createPendingDemoTrialOrder(user.id, PLAN_ID);
  const first = await store.completeDemoTrialOrder(user.id, pending.order.id);
  assert.equal(first.order.status, "paid");
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, true);

  await store.cancelSubscription(user.id, first.subscription.id);
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, false);

  await assert.rejects(
    () => store.completeDemoTrialOrder(user.id, pending.order.id),
    /cannot be completed|already|canceled|paid/,
  );
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, false);
});

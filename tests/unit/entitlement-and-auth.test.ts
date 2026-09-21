import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");
let auth: typeof import("../../services/productAuth");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-entitlement-auth-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  store = await import("../../services/productStore");
  auth = await import("../../services/productAuth");
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) {
    await rm(isolatedCwd, { recursive: true, force: true });
  }
});

test("checkEntitlement takes only userId and courseId — no device argument", () => {
  assert.equal(store.checkEntitlement.length, 2);
});

test("checkEntitlement.allowed is false when the user has no entitlements", async () => {
  const user = await store.registerUser({
    email: "no-entitlement@example.test",
    password: "password1",
  });
  const result = await store.checkEntitlement(user.id, "epicureanism");
  assert.equal(result.allowed, false);
  assert.equal(result.source, null);
  assert.equal(result.validTo, null);
});

test("rejectIfUnauthenticated returns 401 JSON when the Request has no cookie", async () => {
  const denied = await auth.rejectIfUnauthenticated(new Request("http://lg.test/api/courses"));
  assert.ok(denied, "unauthenticated request is rejected");
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { ok: false, error: "Sign in is required." });
});

test("registerUserAttempt does not overwrite an existing password or invent a role", async () => {
  const email = "lock-register@example.test";
  const first = await store.registerUserAttempt({ email, password: "password1", role: "admin" as never });
  assert.equal(first.created, true);
  assert.equal(first.user.role, "student");
  const second = await store.registerUserAttempt({ email, password: "attacker9", role: "operator" });
  assert.equal(second.created, false);
  assert.equal(second.user.role, "student");
  await store.verifyEmailToken(await store.issueEmailVerificationToken(first.user.id));
  assert.equal((await store.authenticateUser(email, "password1")).id, first.user.id);
  await assert.rejects(() => store.authenticateUser(email, "attacker9"), /incorrect/);
  const operator = await store.registerUser({ email: "lock-operator@example.test", password: "password1", role: "operator" });
  assert.equal(operator.role, "operator");
});

test("createSession replaces existing sessions only when asked", async () => {
  const user = await store.registerUser({ email: "lock-session@example.test", password: "password1" });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  const first = await store.createSession(user.id);
  const second = await store.createSession(user.id);
  assert.ok(await store.getUserBySessionToken(first.token));
  assert.ok(await store.getUserBySessionToken(second.token));
  const replaced = await store.createSession(user.id, { replaceExisting: true });
  assert.equal(await store.getUserBySessionToken(first.token), null);
  assert.equal(await store.getUserBySessionToken(second.token), null);
  assert.ok(await store.getUserBySessionToken(replaced.token));
});

test("remembered authentication sessions expire after exactly 14 days", async () => {
  const user = await store.registerUser({ email: "remember-session@example.test", password: "password1" });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  const maxAgeSeconds = 60 * 60 * 24 * 14;
  const session = await store.createSession(user.id, { maxAgeSeconds });
  const stored = (await store.ensureProductData()).sessions.at(-1);
  assert.ok(stored);
  assert.equal(Date.parse(session.expiresAt) - Date.parse(stored.createdAt), maxAgeSeconds * 1000);
  assert.ok(await store.getUserBySessionToken(session.token));
});

test("a cancelled trial cannot be completed again; resume restores the same window", async () => {
  const user = await store.registerUser({ email: "lock-trial@example.test", password: "password1" });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  const { quote } = await store.createQuote(user.id, "epicureanism-pc-6", "trial");
  const { order } = await store.createPendingDemoTrialOrderFromQuote(user.id, quote.id);
  await store.completeDemoTrialOrder(user.id, order.id);
  const before = await store.checkEntitlement(user.id, "epicureanism");
  assert.equal(before.allowed, true);
  assert.equal(before.source, "trial");
  assert.equal(before.device, "pc");
  const trial = (await store.ensureProductData()).subscriptions.find((item) => item.userId === user.id && item.source === "trial");
  assert.ok(trial);
  await store.cancelSubscription(user.id, trial.id);
  assert.equal((await store.checkEntitlement(user.id, "epicureanism")).allowed, false);
  await assert.rejects(() => store.completeDemoTrialOrder(user.id, order.id), /cannot be completed/);
  assert.equal((await store.checkEntitlement(user.id, "epicureanism")).allowed, false);
  await store.resumeSubscription(user.id, trial.id);
  const restored = await store.checkEntitlement(user.id, "epicureanism");
  assert.equal(restored.allowed, true);
  assert.equal(restored.validTo, before.validTo);
});

test("public login uses one 401 body for a pending address and a missing address", async () => {
  const login = await import("../../app/api/auth/login/route");
  const pending = await store.registerUser({ email: "lock-pending-login@example.test", password: "password1" });
  const pendingResponse = await login.POST(new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: pending.email, password: "password1" }),
  }));
  const missingResponse = await login.POST(new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "lock-missing-login@example.test", password: "password1" }),
  }));
  const pendingBody = await pendingResponse.json() as Record<string, unknown>;
  const missingBody = await missingResponse.json() as Record<string, unknown>;
  delete pendingBody.requestId;
  delete missingBody.requestId;
  assert.equal(pendingResponse.status, 401);
  assert.equal(missingResponse.status, 401);
  assert.deepEqual(pendingBody, missingBody);
  assert.equal(pendingBody.code, "AUTHENTICATION_FAILED");
});

test("the same purchase plan cannot be quoted again while access is active", async () => {
  const user = await store.registerUser({ email: "lock-quote@example.test", password: "password1" });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  const { quote } = await store.createQuote(user.id, "everything-pc-6");
  const { order } = await store.createPendingDemoOrder(user.id, quote.id);
  await store.completeDemoOrder(user.id, order.id);
  await assert.rejects(() => store.createQuote(user.id, "everything-pc-6"), /already has active access/);
});

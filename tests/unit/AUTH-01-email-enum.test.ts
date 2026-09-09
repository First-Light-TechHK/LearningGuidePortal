import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Break: check-email `exists`, register "already exists" copy, resend 429
// on pending only, or login 403 only for pending (AUTH-01 / API-AUTH-001).
// Lock same-shaped answers. Do not add extra probes.

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
const originalSesFrom = process.env.SES_FROM_EMAIL;
const originalVerification = process.env.EMAIL_VERIFICATION_REQUIRED;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");
let checkEmail: typeof import("../../app/api/auth/check-email/route").POST;
let register: typeof import("../../app/api/auth/register/route").POST;
let resend: typeof import("../../app/api/auth/resend-verification/route").POST;
let login: typeof import("../../app/api/auth/login/route").POST;

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-auth-01-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  process.env.EMAIL_VERIFICATION_REQUIRED = "0";
  store = await import("../../services/productStore");
  ({ POST: checkEmail } = await import("../../app/api/auth/check-email/route"));
  ({ POST: register } = await import("../../app/api/auth/register/route"));
  ({ POST: resend } = await import("../../app/api/auth/resend-verification/route"));
  ({ POST: login } = await import("../../app/api/auth/login/route"));
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (originalSesFrom === undefined) delete process.env.SES_FROM_EMAIL;
  else process.env.SES_FROM_EMAIL = originalSesFrom;
  if (originalVerification === undefined) delete process.env.EMAIL_VERIFICATION_REQUIRED;
  else process.env.EMAIL_VERIFICATION_REQUIRED = originalVerification;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) {
    await rm(isolatedCwd, { recursive: true, force: true });
  }
});

function post(url: string, body: Record<string, string>) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function publicShape(body: Record<string, unknown>) {
  const copy = { ...body };
  delete copy.requestId;
  return copy;
}

test("AUTH-01: check-email does not distinguish a known address from an unknown one", async () => {
  const user = await store.registerUser({
    email: "auth-01-known@example.test",
    password: "password1",
    nickname: "Auth One",
  });
  const known = await checkEmail(post("http://lg.test/api/auth/check-email", { email: user.email || "" }));
  const unknown = await checkEmail(post("http://lg.test/api/auth/check-email", { email: "auth-01-unknown@example.test" }));
  assert.equal(known.status, unknown.status);
  const knownBody = await known.json() as Record<string, unknown>;
  const unknownBody = await unknown.json() as Record<string, unknown>;
  assert.equal("exists" in knownBody, false);
  assert.equal("exists" in unknownBody, false);
  assert.deepEqual(Object.keys(knownBody).sort(), Object.keys(unknownBody).sort());
  assert.deepEqual(publicShape(knownBody), publicShape(unknownBody));
});

test("AUTH-01: register copy does not say the address already exists", async () => {
  const email = "auth-01-register@example.test";
  const first = await register(post("http://lg.test/api/auth/register", {
    email,
    password: "password1",
    nickname: "Auth One",
  }));
  const second = await register(post("http://lg.test/api/auth/register", {
    email,
    password: "password9",
    nickname: "Other Name",
  }));
  assert.equal(first.status, second.status);
  const firstBody = await first.json() as Record<string, unknown>;
  const secondBody = await second.json() as Record<string, unknown>;
  const text = JSON.stringify(secondBody).toLowerCase();
  assert.equal(text.includes("already exists"), false);
  assert.equal(firstBody.ok, secondBody.ok);
});

test("AUTH-01: resend-verification does not 429 only for a pending address", async () => {
  process.env.SES_FROM_EMAIL = "noreply@example.test";
  const user = await store.registerUser({
    email: "auth-01-pending@example.test",
    password: "password1",
    nickname: "Auth One",
  });
  await store.issueEmailVerificationToken(user.id, true);

  const pending = await resend(post("http://lg.test/api/auth/resend-verification", {
    email: user.email || "",
    locale: "en-GB",
  }));
  const missing = await resend(post("http://lg.test/api/auth/resend-verification", {
    email: "auth-01-missing@example.test",
    locale: "en-GB",
  }));
  assert.equal(pending.status, missing.status);
  assert.notEqual(pending.status, 429);
  const pendingBody = await pending.json() as Record<string, unknown>;
  const missingBody = await missing.json() as Record<string, unknown>;
  assert.deepEqual(publicShape(pendingBody), publicShape(missingBody));
});

test("AUTH-01: login does not 403 only for a pending address", async () => {
  const user = await store.registerUser({
    email: "auth-01-login-pending@example.test",
    password: "password1",
    nickname: "Auth One",
  });
  const pending = await login(post("http://lg.test/api/auth/login", {
    email: user.email || "",
    password: "password1",
  }));
  const missing = await login(post("http://lg.test/api/auth/login", {
    email: "auth-01-login-missing@example.test",
    password: "password1",
  }));
  assert.equal(pending.status, missing.status);
  assert.notEqual(pending.status, 403);
  const pendingBody = await pending.json() as Record<string, unknown>;
  const missingBody = await missing.json() as Record<string, unknown>;
  assert.equal(pendingBody.code, missingBody.code);
  assert.deepEqual(publicShape(pendingBody), publicShape(missingBody));
});

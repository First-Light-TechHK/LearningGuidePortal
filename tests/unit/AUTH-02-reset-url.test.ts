import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Break: password-reset JSON includes resetUrl or a raw token (AUTH-02).

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
const originalAppEnv = process.env.APP_ENV;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");
let requestReset: typeof import("../../app/api/auth/password-reset/request/route").POST;

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-auth-02-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  process.env.APP_ENV = "DEV";
  store = await import("../../services/productStore");
  ({ POST: requestReset } = await import("../../app/api/auth/password-reset/request/route"));
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (originalAppEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = originalAppEnv;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) {
    await rm(isolatedCwd, { recursive: true, force: true });
  }
});

test("AUTH-02: reset request JSON must not include resetUrl or token", async () => {
  const user = await store.registerUser({
    email: "auth-02-reset@example.test",
    password: "password1",
    nickname: "Auth Two",
  });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));

  const response = await requestReset(new Request("http://lg.test/api/auth/password-reset/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, locale: "en-GB" }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal(body.resetUrl, undefined);
  assert.equal(body.token, undefined);
  assert.equal(JSON.stringify(body).includes("token="), false);
});

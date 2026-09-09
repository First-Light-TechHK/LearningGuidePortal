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

test("checkEntitlement accepts userId, courseId, and optional device", () => {
  assert.ok(store.checkEntitlement.length >= 2);
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

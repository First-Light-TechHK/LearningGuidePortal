import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Corner on AUTH-05 (single instance): a second registerUser for a pending
// email must not overwrite passwordHash (last-write-wins takeover).

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-auth-05-"));
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

test("AUTH-05 corner: pending re-register does not overwrite the first password", async () => {
  const email = "auth-05-pending@example.test";
  const first = await store.registerUser({ email, password: "password1", nickname: "First Owner" });
  assert.equal(first.status, "pending");

  await assert.rejects(
    () => store.registerUser({ email, password: "attacker9", nickname: "Attacker" }),
    /already exists/,
  );

  const activated = await store.verifyEmailToken(await store.issueEmailVerificationToken(first.id));
  assert.equal(activated.status, "active");
  const signedIn = await store.authenticateUser(email, "password1");
  assert.equal(signedIn.id, first.id);
  await assert.rejects(() => store.authenticateUser(email, "attacker9"), /incorrect/);
});

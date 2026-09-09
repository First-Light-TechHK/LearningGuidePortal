import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Break: createSession or profile password change leaving the previous
// session token valid (AUTH-06).

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-auth-06-"));
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

test("AUTH-06: a second login session invalidates the first session", async () => {
  const user = await store.registerUser({
    email: "auth-06-login@example.test",
    password: "password1",
    nickname: "Auth Six",
  });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));

  const sessionA = await store.createSession(user.id);
  const sessionB = await store.createSession(user.id);

  assert.equal((await store.getUserBySessionToken(sessionB.token))?.id, user.id);
  assert.equal(await store.getUserBySessionToken(sessionA.token), null);
});

test("AUTH-06: changing password from profile invalidates other sessions", async () => {
  const user = await store.registerUser({
    email: "auth-06-profile@example.test",
    password: "password1",
    nickname: "Auth Six",
  });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  const session = await store.createSession(user.id);

  await store.updateUserProfile({
    userId: user.id,
    nickname: "Auth Six",
    locale: "en-GB",
    currentPassword: "password1",
    newPassword: "password2",
  });

  assert.equal(await store.getUserBySessionToken(session.token), null);
});

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readProductData, writeProductData } from "./helpers/my-learning";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-auth-reset-"));
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

async function activeUser(email: string, password = "Passw0rd!123") {
  const user = await store.registerUser({ email, password, nickname: "Reset Learner", locale: "en-GB" });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  return { user, password };
}

test("password reset token is single-use and the second confirm keeps the first new password", async () => {
  const email = "reset-once@example.test";
  const { password } = await activeUser(email);
  const issued = await store.requestPasswordReset(email);
  assert.ok(issued.token);

  await store.resetPassword(issued.token, "Passw0rd!999");
  await assert.rejects(
    store.resetPassword(issued.token, "Passw0rd!000"),
    /invalid or has expired/i
  );

  await assert.rejects(store.authenticateUser(email, password), /incorrect/i);
  const signedIn = await store.authenticateUser(email, "Passw0rd!999");
  assert.equal(signedIn.email, email);
});

test("an expired password reset token cannot change the password", async () => {
  const email = "reset-expired@example.test";
  const { user, password } = await activeUser(email);
  const issued = await store.requestPasswordReset(email);
  assert.ok(issued.token);

  const data = await readProductData();
  const tokenRow = data.passwordResetTokens.find((item: { userId: string; usedAt: string | null }) => (
    item.userId === user.id && item.usedAt === null
  ));
  assert.ok(tokenRow);
  tokenRow.expiresAt = "2000-01-01T00:00:00.000Z";
  await writeProductData(data);

  await assert.rejects(store.resetPassword(issued.token, "Passw0rd!777"), /invalid or has expired/i);
  const signedIn = await store.authenticateUser(email, password);
  assert.equal(signedIn.id, user.id);
});

test("resetPassword deletes every session for that user", async () => {
  const email = "reset-kick@example.test";
  const { user } = await activeUser(email);
  const first = await store.createSession(user.id);
  const second = await store.createSession(user.id, { replaceExisting: true });
  assert.equal(await store.getUserBySessionToken(first.token), null);
  assert.equal((await store.getUserBySessionToken(second.token))?.id, user.id);

  const issued = await store.requestPasswordReset(email);
  assert.ok(issued.token);
  await store.resetPassword(issued.token, "Passw0rd!888");

  assert.equal(await store.getUserBySessionToken(second.token), null);
  await assert.rejects(store.authenticateUser(email, "Passw0rd!123"), /incorrect/i);
});

test("verifyEmailToken is single-use and a second POST-equivalent call fails", async () => {
  const user = await store.registerUser({
    email: "verify-once@example.test",
    password: "Passw0rd!123",
    nickname: "Pending",
    locale: "en-GB"
  });
  assert.equal(user.status, "pending");
  const token = await store.issueEmailVerificationToken(user.id);
  const activated = await store.verifyEmailToken(token);
  assert.equal(activated.status, "active");
  await assert.rejects(store.verifyEmailToken(token), /invalid or has expired/i);
});

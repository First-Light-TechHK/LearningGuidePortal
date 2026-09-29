import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

const FIRST_PASSWORD = "Passw0rd!123";
const CHANGED_PASSWORD = "Changed-password-123";
const ACCEPTED = { ok: true, accepted: true, retryAfter: 60 };

type StoreModule = typeof import("../../services/productStore");
type ResetToken = { userId: string; tokenHash: string; createdAt: string; usedAt: string | null };

const envSnapshot = { ...process.env };
const originalCwd = process.cwd();
let temp = "";
let relocated = false;
let resetRoute: typeof import("../../app/api/auth/password-reset/request/route");
let store: StoreModule;
let sequence = 0;

function restoreEnv(snapshot: NodeJS.ProcessEnv) {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) delete process.env[key];
  }
  Object.assign(process.env, snapshot);
}

function uniqueEmail(label: string) {
  sequence += 1;
  return `${label}-${sequence}-${Date.now()}@example.test`;
}

function useEnvironment(appEnv: "DEV" | "UAT", delivery: "discard" | "fail" | "") {
  process.env.APP_ENV = appEnv;
  process.env.EMAIL_DELIVERY = delivery;
  process.env.NEXT_PUBLIC_APP_URL = appEnv === "DEV" ? "http://localhost:3000" : "https://example.test";
}

function resetRequest(email: string, origin = new URL(process.env.NEXT_PUBLIC_APP_URL!).origin) {
  const url = `${origin}/api/auth/password-reset/request`;
  return resetRoute.POST(new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin, host: new URL(url).host },
    body: JSON.stringify({ email, locale: "en-GB" })
  }));
}

function productFile() {
  return path.join(process.cwd(), "data", "knowledge_system", "learning_guide", "product.json");
}

async function resetTokens(userId: string) {
  const data = JSON.parse(await readFile(productFile(), "utf8")) as { passwordResetTokens: ResetToken[] };
  return data.passwordResetTokens.filter((item) => item.userId === userId);
}

async function ageResetTokens(userId: string) {
  const data = JSON.parse(await readFile(productFile(), "utf8")) as { passwordResetTokens: ResetToken[] };
  const aged = new Date(Date.now() - 120_000).toISOString();
  for (const token of data.passwordResetTokens) {
    if (token.userId === userId) token.createdAt = aged;
  }
  await writeFile(productFile(), JSON.stringify(data));
}

async function activeUserWithLiveReset(label: string) {
  const email = uniqueEmail(label);
  const user = await store.registerUser({ email, password: FIRST_PASSWORD, locale: "en-GB" });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  const { token } = await store.requestPasswordReset(email);
  assert.ok(token);
  await ageResetTokens(user.id);
  return { email, userId: user.id, token };
}

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "lg-reset-legal-"));
  process.chdir(temp);
  relocated = true;
  Object.assign(process.env, { STORAGE_BACKEND: "local", EMAIL_VERIFICATION_REQUIRED: "1" });
  delete process.env.DATABASE_URL;
  delete process.env.DATA_S3_BUCKET;
  delete process.env.SES_FROM_EMAIL;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.LOCAL_PASSWORD_RESET_PREVIEW;
  useEnvironment("DEV", "discard");
  resetRoute = await import("../../app/api/auth/password-reset/request/route");
  store = await import("../../services/productStore");
});

after(async () => {
  if (relocated) process.chdir(originalCwd);
  restoreEnv(envSnapshot);
  if (temp) await rm(temp, { recursive: true, force: true });
});

describe("password reset legal transition", { concurrency: false }, () => {
  test("rejected reset mail answers like an unknown address and keeps the live link", async () => {
    useEnvironment("DEV", "discard");
    const { email, userId, token } = await activeUserWithLiveReset("reset-fail");
    const before = await resetTokens(userId);
    assert.equal(before.filter((item) => !item.usedAt).length, 1);

    useEnvironment("DEV", "fail");
    const known = await resetRequest(email);
    const unknown = await resetRequest(uniqueEmail("reset-unknown"));
    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.deepEqual(await known.json(), ACCEPTED);
    assert.deepEqual(await unknown.json(), ACCEPTED);
    assert.deepEqual(await resetTokens(userId), before);

    await store.resetPassword(token, CHANGED_PASSWORD);
    assert.equal((await store.authenticateUser(email, CHANGED_PASSWORD)).id, userId);
  });

  test("a rejected send does not start the cooldown and an accepted send replaces the link", async () => {
    useEnvironment("DEV", "discard");
    const { email, userId, token } = await activeUserWithLiveReset("reset-retry");
    const before = await resetTokens(userId);

    useEnvironment("DEV", "fail");
    assert.deepEqual(await (await resetRequest(email)).json(), ACCEPTED);
    assert.deepEqual(await resetTokens(userId), before);

    useEnvironment("DEV", "discard");
    assert.deepEqual(await (await resetRequest(email)).json(), ACCEPTED);
    const after = await resetTokens(userId);
    assert.equal(after.length, before.length + 1);
    assert.equal(after.filter((item) => !item.usedAt).length, 1);
    assert.notEqual(after[0]?.tokenHash, before[0]?.tokenHash);
    await assert.rejects(store.resetPassword(token, CHANGED_PASSWORD), /invalid or has expired/);

    assert.deepEqual(await (await resetRequest(email)).json(), ACCEPTED);
    assert.equal((await resetTokens(userId)).length, after.length);
  });

  test("managed environment answers 200 for known and unknown addresses when the send is rejected", async () => {
    useEnvironment("DEV", "discard");
    const { email, userId, token } = await activeUserWithLiveReset("reset-managed");
    const before = await resetTokens(userId);

    useEnvironment("UAT", "fail");
    const known = await resetRequest(email);
    const unknown = await resetRequest(uniqueEmail("reset-managed-unknown"));
    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.deepEqual(await known.json(), ACCEPTED);
    assert.deepEqual(await unknown.json(), ACCEPTED);
    assert.deepEqual(await resetTokens(userId), before);

    useEnvironment("UAT", "discard");
    assert.deepEqual(await (await resetRequest(email)).json(), ACCEPTED);
    assert.equal((await resetTokens(userId)).filter((item) => !item.usedAt).length, 1);
    await assert.rejects(store.resetPassword(token, CHANGED_PASSWORD), /invalid or has expired/);
  });

  test("managed environment without delivery returns 503 before any account lookup", async () => {
    useEnvironment("DEV", "discard");
    const { email, userId } = await activeUserWithLiveReset("reset-unconfigured");
    const before = await resetTokens(userId);

    useEnvironment("UAT", "");
    const known = await resetRequest(email);
    const unknown = await resetRequest(uniqueEmail("reset-unconfigured-unknown"));
    assert.equal(known.status, 503);
    assert.equal(unknown.status, 503);
    assert.deepEqual(await known.json(), { ok: false, code: "email_unavailable" });
    assert.deepEqual(await unknown.json(), { ok: false, code: "email_unavailable" });
    assert.deepEqual(await resetTokens(userId), before);
  });

  test("managed environment without a public origin returns 503 for every address", async () => {
    useEnvironment("DEV", "discard");
    const { email, userId } = await activeUserWithLiveReset("reset-origin");
    const before = await resetTokens(userId);

    useEnvironment("UAT", "discard");
    delete process.env.NEXT_PUBLIC_APP_URL;
    const known = await resetRequest(email, "https://example.test");
    const unknown = await resetRequest(uniqueEmail("reset-origin-unknown"), "https://example.test");
    assert.equal(known.status, 503);
    assert.equal(unknown.status, 503);
    assert.deepEqual(await known.json(), await unknown.json());
    assert.deepEqual(await resetTokens(userId), before);
  });

  test("a foreign Origin header is rejected for known and unknown addresses alike", async () => {
    useEnvironment("DEV", "discard");
    const { email, userId } = await activeUserWithLiveReset("reset-foreign");
    const before = await resetTokens(userId);

    useEnvironment("UAT", "discard");
    const foreign = (address: string) => resetRoute.POST(new Request("https://example.test/api/auth/password-reset/request", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.invalid", host: "example.test" },
      body: JSON.stringify({ email: address, locale: "en-GB" })
    }));
    const known = await foreign(email);
    const unknown = await foreign(uniqueEmail("reset-foreign-unknown"));
    assert.equal(known.status, 400);
    assert.equal(unknown.status, 400);
    assert.deepEqual(await known.json(), await unknown.json());
    assert.deepEqual(await resetTokens(userId), before);
  });
});

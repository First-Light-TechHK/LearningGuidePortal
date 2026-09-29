// Locks AUTH-01 / AUTH-02 public contracts that still fail on 83778295.
// Not part of npm test:ci or Verify.
import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, mock, test } from "node:test";
import nodemailer from "nodemailer";
import { atomicWriteJson, systemRoot } from "../../services/fileStore";
import { PASSWORD, isolate, jsonRequest, publicShape, uniqueEmail } from "../io/harness";

const PASSWORD_RESET_URL = "https://example.test/api/auth/password-reset/request";
const CONFIRM_URL = "https://example.test/api/auth/password-reset/confirm";
const REPLACEMENT_PASSWORD = "Changed-password-123";

let restore: () => Promise<void>;
let baselineEnv: NodeJS.ProcessEnv;
let sendShouldFail = false;
let sendCount = 0;
let store: typeof import("../../services/productStore");
let checkEmail: typeof import("../../app/api/auth/check-email/route");
let resend: typeof import("../../app/api/auth/resend-verification/route");
let register: typeof import("../../app/api/auth/register/route");
let resetRequest: typeof import("../../app/api/auth/password-reset/request/route");
let resetConfirm: typeof import("../../app/api/auth/password-reset/confirm/route");

function containsKey(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsKey(item, key));
  return Object.keys(value).includes(key) || Object.values(value).some((item) => containsKey(item, key));
}

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in baselineEnv)) delete process.env[key];
  }
  Object.assign(process.env, baselineEnv);
  sendShouldFail = false;
  sendCount = 0;
}

function configureSmtp() {
  Object.assign(process.env, {
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "1",
    SMTP_SECURE: "0",
    SMTP_USER: "sender@example.test",
    SMTP_PASS: "test-only",
    SMTP_FROM: "sender@example.test"
  });
}

function productFile() {
  return path.join(systemRoot(), "learning_guide", "product.json");
}

async function readBody(response: Response) {
  return await response.json() as Record<string, unknown>;
}

function registerPayload(email: string) {
  return { email, password: PASSWORD, nickname: "Lock Learner", locale: "en-GB" as const };
}

function comparableRegisterShape(body: Record<string, unknown>) {
  const shape = publicShape(body);
  const data = shape.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return shape;
  const dataCopy = { ...(data as Record<string, unknown>) };
  const user = dataCopy.user;
  if (user && typeof user === "object" && !Array.isArray(user)) {
    const userCopy = { ...(user as Record<string, unknown>) };
    delete userCopy.id;
    delete userCopy.email;
    dataCopy.user = userCopy;
  }
  shape.data = dataCopy;
  return shape;
}

async function createPending(label: string) {
  const email = uniqueEmail(label);
  const { user } = await store.registerUserAttempt({ email, password: PASSWORD, nickname: "Pending Learner" });
  await store.issueEmailVerificationToken(user.id);
  return { email, userId: user.id };
}

async function createVerified(label: string) {
  const email = uniqueEmail(label);
  const { user } = await store.registerUserAttempt({ email, password: PASSWORD, nickname: "Verified Learner" });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  return { email, userId: user.id };
}

async function ageUnusedToken(collection: "verificationTokens" | "passwordResetTokens", userId: string) {
  const data = await store.ensureProductData();
  const token = data[collection].find((item) => item.userId === userId && !item.usedAt);
  assert.ok(token, `expected an unused ${collection} row`);
  token.createdAt = new Date(Date.now() - 120_000).toISOString();
  await atomicWriteJson(productFile(), data);
  return token.tokenHash;
}

async function unusedTokenHashes(collection: "verificationTokens" | "passwordResetTokens", userId: string) {
  const data = await store.ensureProductData();
  return data[collection].filter((item) => item.userId === userId && !item.usedAt).map((item) => item.tokenHash);
}

describe("auth bug locks", { concurrency: false }, () => {
  before(async () => {
    restore = (await isolate("lg-auth-bug-locks-")).restore;
    baselineEnv = { ...process.env };
    mock.method(nodemailer, "createTransport", () => ({
      sendMail: async () => {
        sendCount += 1;
        if (sendShouldFail) throw new Error("SMTP connection refused");
      }
    }));
    store = await import("../../services/productStore");
    checkEmail = await import("../../app/api/auth/check-email/route");
    resend = await import("../../app/api/auth/resend-verification/route");
    register = await import("../../app/api/auth/register/route");
    resetRequest = await import("../../app/api/auth/password-reset/request/route");
    resetConfirm = await import("../../app/api/auth/password-reset/confirm/route");
  });

  after(async () => {
    mock.restoreAll();
    await restore();
  });

  test("AUTH-01 check-email pending, active, and unknown share one public shape without exists or pending", async () => {
    resetEnv();
    const pendingAccount = await createPending("check-pending");
    const activeAccount = await createVerified("check-active");
    const unknownEmail = uniqueEmail("check-unknown");
    const pending = await checkEmail.POST(jsonRequest("POST", "http://localhost/api/auth/check-email", { email: pendingAccount.email }));
    const active = await checkEmail.POST(jsonRequest("POST", "http://localhost/api/auth/check-email", { email: activeAccount.email }));
    const unknown = await checkEmail.POST(jsonRequest("POST", "http://localhost/api/auth/check-email", { email: unknownEmail }));
    const views = await Promise.all([pending, active, unknown].map(async (response) => {
      const body = await readBody(response);
      return {
        status: response.status,
        hasExists: containsKey(body, "exists"),
        hasPending: containsKey(body, "pending"),
        shape: publicShape(body)
      };
    }));
    const shared = { status: views[2].status, hasExists: false, hasPending: false, shape: views[2].shape };
    assert.deepEqual(views, [shared, shared, shared]);
  });

  test("AUTH-01 resend during cooldown does not 429 only for a pending address", async () => {
    resetEnv();
    configureSmtp();
    const pendingAccount = await createPending("resend-cooldown");
    const pending = await resend.POST(jsonRequest("POST", "http://localhost/api/auth/resend-verification", { email: pendingAccount.email, locale: "en-GB" }));
    const unknown = await resend.POST(jsonRequest("POST", "http://localhost/api/auth/resend-verification", { email: uniqueEmail("resend-cooldown-unknown"), locale: "en-GB" }));
    assert.deepEqual(
      { status: pending.status, shape: publicShape(await readBody(pending)) },
      { status: unknown.status, shape: publicShape(await readBody(unknown)) }
    );
  });

  test("AUTH-01 resend send failure uses the same public status for pending and unknown", async () => {
    resetEnv();
    configureSmtp();
    sendShouldFail = true;
    const pendingAccount = await createPending("resend-fail");
    await ageUnusedToken("verificationTokens", pendingAccount.userId);
    const pending = await resend.POST(jsonRequest("POST", "http://localhost/api/auth/resend-verification", { email: pendingAccount.email, locale: "en-GB" }));
    const unknown = await resend.POST(jsonRequest("POST", "http://localhost/api/auth/resend-verification", { email: uniqueEmail("resend-fail-unknown"), locale: "en-GB" }));
    assert.deepEqual(
      { status: pending.status, shape: publicShape(await readBody(pending)) },
      { status: unknown.status, shape: publicShape(await readBody(unknown)) }
    );
  });

  test("AUTH-01 resend send failure leaves the previous unused verification token hash unchanged", async () => {
    resetEnv();
    configureSmtp();
    sendShouldFail = true;
    const pendingAccount = await createPending("resend-hash");
    const previousHash = await ageUnusedToken("verificationTokens", pendingAccount.userId);
    const sendsBefore = sendCount;
    await resend.POST(jsonRequest("POST", "http://localhost/api/auth/resend-verification", { email: pendingAccount.email, locale: "en-GB" }));
    assert.equal(sendCount, sendsBefore + 1);
    assert.deepEqual(await unusedTokenHashes("verificationTokens", pendingAccount.userId), [previousHash]);
  });

  test("AUTH-02 managed password reset send failure uses the same public status for a verified account and an unknown address", async () => {
    resetEnv();
    configureSmtp();
    sendShouldFail = true;
    process.env.APP_ENV = "UAT";
    process.env.NEXT_PUBLIC_APP_URL = "https://example.test";
    const account = await createVerified("reset-known");
    const known = await resetRequest.POST(jsonRequest("POST", PASSWORD_RESET_URL, { email: account.email, locale: "en-GB" }));
    const unknown = await resetRequest.POST(jsonRequest("POST", PASSWORD_RESET_URL, { email: uniqueEmail("reset-unknown"), locale: "en-GB" }));
    assert.deepEqual(
      { status: known.status, shape: publicShape(await readBody(known)) },
      { status: unknown.status, shape: publicShape(await readBody(unknown)) }
    );
  });

  test("AUTH-02 a live password reset token still works when the subsequent send fails", async () => {
    resetEnv();
    configureSmtp();
    process.env.APP_ENV = "UAT";
    process.env.NEXT_PUBLIC_APP_URL = "https://example.test";
    const account = await createVerified("reset-live");
    const issued = await store.requestPasswordReset(account.email, false);
    assert.ok(issued.token);
    await ageUnusedToken("passwordResetTokens", account.userId);
    sendShouldFail = true;
    const sendsBefore = sendCount;
    await resetRequest.POST(jsonRequest("POST", PASSWORD_RESET_URL, { email: account.email, locale: "en-GB" }));
    assert.equal(sendCount, sendsBefore + 1);
    const confirm = await resetConfirm.POST(jsonRequest("POST", CONFIRM_URL, { token: issued.token, newPassword: REPLACEMENT_PASSWORD }));
    assert.equal(confirm.status, 200);
  });

  test("AUTH-01 register send failure leaves no user and no unused verification token", async () => {
    resetEnv();
    process.env.APP_ENV = "DEV";
    process.env.EMAIL_VERIFICATION_REQUIRED = "1";
    configureSmtp();
    sendShouldFail = true;
    const email = uniqueEmail("register-fail");
    const sendsBefore = sendCount;
    await register.POST(jsonRequest("POST", "http://localhost/api/auth/register", registerPayload(email)));
    assert.equal(sendCount, sendsBefore + 1);
    const data = await store.ensureProductData();
    const users = data.users.filter((user) => user.email === email);
    const unusedTokens = data.verificationTokens.filter((token) => !token.usedAt && users.some((user) => user.id === token.userId));
    assert.deepEqual({ users: users.length, unusedTokens: unusedTokens.length }, { users: 0, unusedTokens: 0 });
  });

  test("AUTH-01 a second pending register during cooldown shares the public status of a new address", async () => {
    resetEnv();
    process.env.APP_ENV = "DEV";
    process.env.EMAIL_VERIFICATION_REQUIRED = "1";
    configureSmtp();
    const email = uniqueEmail("register-again");
    const first = await register.POST(jsonRequest("POST", "http://localhost/api/auth/register", registerPayload(email)));
    assert.equal(first.status, 200);
    const second = await register.POST(jsonRequest("POST", "http://localhost/api/auth/register", registerPayload(email)));
    const fresh = await register.POST(jsonRequest("POST", "http://localhost/api/auth/register", registerPayload(uniqueEmail("register-fresh"))));
    assert.deepEqual(
      { status: second.status, shape: comparableRegisterShape(await readBody(second)) },
      { status: fresh.status, shape: comparableRegisterShape(await readBody(fresh)) }
    );
  });
});

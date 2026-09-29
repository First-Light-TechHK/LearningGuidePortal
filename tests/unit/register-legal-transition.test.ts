import assert from "node:assert/strict";
import { scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = "learning_guide_session";
const FIRST_PASSWORD = "Passw0rd!123";
const ATTACKER_PASSWORD = "attacker9";

type ApiBody = {
  ok?: boolean;
  code?: string;
  message?: string;
  requestId?: string;
  data?: {
    verificationRequired?: boolean;
    accepted?: boolean;
    user?: unknown;
  };
};

type StoreModule = typeof import("../../services/productStore");

const envSnapshot = { ...process.env };
const originalCwd = process.cwd();
let temp = "";
let relocated = false;
let registerRoute: typeof import("../../app/api/auth/register/route");
let resendRoute: typeof import("../../app/api/auth/resend-verification/route");
let loginRoute: typeof import("../../app/api/auth/login/route");
let store: StoreModule;
let sequence = 0;

function restoreEnv(snapshot: NodeJS.ProcessEnv) {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) delete process.env[key];
  }
  Object.assign(process.env, snapshot);
}

function jsonRequest(url: string, body: Record<string, unknown>) {
  const parsed = new URL(url);
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: parsed.origin,
      host: parsed.host
    },
    body: JSON.stringify(body)
  });
}

function setCookieHeaders(response: Response) {
  const listed = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  if (listed.length > 0) return listed;
  const fallback = response.headers.get("set-cookie");
  return fallback ? [fallback] : [];
}

function hasSessionCookie(response: Response) {
  return setCookieHeaders(response).some((header) => header.startsWith(`${SESSION_COOKIE}=`));
}

function publicShape(body: ApiBody) {
  const copy: ApiBody = { ...body };
  delete copy.requestId;
  return copy;
}

function uniqueEmail(label: string) {
  sequence += 1;
  return `${label}-${sequence}-${Date.now()}@example.test`;
}

function clearMailTransport() {
  delete process.env.SES_FROM_EMAIL;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_FROM;
}

function useDelivery(mode: "discard" | "fail" | "", verification: "0" | "1") {
  process.env.EMAIL_VERIFICATION_REQUIRED = verification;
  process.env.EMAIL_DELIVERY = mode;
  clearMailTransport();
}

function productFile() {
  return path.join(process.cwd(), "data", "knowledge_system", "learning_guide", "product.json");
}

async function passwordMatches(password: string, stored: string | null) {
  if (!stored?.startsWith("scrypt$")) return false;
  const [, salt, value] = stored.split("$");
  if (!salt || !value) return false;
  const actual = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(value, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function findUser(email: string) {
  const data = await store.ensureProductData();
  return { data, user: data.users.find((item) => item.email === email) };
}

function tokensFor(data: Awaited<ReturnType<StoreModule["ensureProductData"]>>, userId: string) {
  return data.verificationTokens.filter((item) => item.userId === userId);
}

function registerBody(email: string, password: string) {
  return { email, password, nickname: "Learner", locale: "en-GB" };
}

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "lg-register-legal-"));
  process.chdir(temp);
  relocated = true;
  Object.assign(process.env, {
    APP_ENV: "DEV",
    STORAGE_BACKEND: "local",
    EMAIL_VERIFICATION_REQUIRED: "0",
    EMAIL_DELIVERY: "",
    SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000"
  });
  delete process.env.DATABASE_URL;
  delete process.env.DATA_S3_BUCKET;
  clearMailTransport();
  registerRoute = await import("../../app/api/auth/register/route");
  resendRoute = await import("../../app/api/auth/resend-verification/route");
  loginRoute = await import("../../app/api/auth/login/route");
  store = await import("../../services/productStore");
});

after(async () => {
  if (relocated) process.chdir(originalCwd);
  restoreEnv(envSnapshot);
  if (temp) await rm(temp, { recursive: true, force: true });
});

describe("registration legal transition", { concurrency: false }, () => {
  test("discard register keeps one pending user and the original password until verify", async () => {
    useDelivery("discard", "1");
    const email = uniqueEmail("discard");
    const created = await registerRoute.POST(jsonRequest("http://localhost/api/auth/register", registerBody(email, FIRST_PASSWORD)));
    const createdBody = await created.json() as ApiBody;
    assert.equal(created.status, 200);
    assert.equal(createdBody.ok, true);
    assert.equal(createdBody.data?.verificationRequired, true);
    assert.equal("user" in (createdBody.data ?? {}), false);
    assert.equal("user" in createdBody, false);
    assert.equal(hasSessionCookie(created), false);

    const stored = await findUser(email);
    assert.ok(stored.user);
    assert.equal(stored.user.status, "pending");
    const issued = tokensFor(stored.data, stored.user.id);
    assert.equal(issued.length, 1);
    assert.equal(issued[0]?.usedAt, null);
    const liveHash = issued[0]?.tokenHash;
    const passwordHash = stored.user.passwordHash;
    assert.equal(await passwordMatches(FIRST_PASSWORD, passwordHash), true);

    const duplicate = await registerRoute.POST(jsonRequest("http://localhost/api/auth/register", registerBody(email, ATTACKER_PASSWORD)));
    const duplicateBody = await duplicate.json() as ApiBody;
    assert.equal(duplicate.status, 200);
    assert.equal(duplicateBody.ok, true);
    assert.equal(duplicateBody.data?.verificationRequired, true);
    assert.equal("user" in (duplicateBody.data ?? {}), false);

    const afterDuplicate = await findUser(email);
    assert.ok(afterDuplicate.user);
    assert.equal(afterDuplicate.user.status, "pending");
    assert.equal(afterDuplicate.user.passwordHash, passwordHash);
    const stillLive = tokensFor(afterDuplicate.data, afterDuplicate.user.id);
    assert.equal(stillLive.length, 1);
    assert.equal(stillLive[0]?.usedAt, null);
    assert.equal(stillLive[0]?.tokenHash, liveHash);
    assert.equal(await passwordMatches(ATTACKER_PASSWORD, afterDuplicate.user.passwordHash), false);

    const owner = await loginRoute.POST(jsonRequest("http://localhost/api/auth/sign-in", { email, password: FIRST_PASSWORD }));
    const attacker = await loginRoute.POST(jsonRequest("http://localhost/api/auth/sign-in", { email, password: ATTACKER_PASSWORD }));
    assert.notEqual(owner.status, 200);
    assert.notEqual(attacker.status, 200);
    assert.equal(hasSessionCookie(owner), false);
    assert.equal(hasSessionCookie(attacker), false);
  });

  test("failed verification mail does not commit the user", async () => {
    useDelivery("fail", "1");
    const email = uniqueEmail("fail");
    const response = await registerRoute.POST(jsonRequest("http://localhost/api/auth/register", registerBody(email, FIRST_PASSWORD)));
    const body = await response.json() as ApiBody;
    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    assert.equal(body.code, "EMAIL_DELIVERY_FAILED");
    assert.equal((await findUser(email)).user, undefined);
    assert.equal(hasSessionCookie(response), false);
  });

  test("missing mail configuration returns 503 before the existence check and commits nothing", async () => {
    useDelivery("discard", "1");
    const existingEmail = uniqueEmail("unconfigured-existing");
    const created = await registerRoute.POST(jsonRequest("http://localhost/api/auth/register", registerBody(existingEmail, FIRST_PASSWORD)));
    assert.equal(created.status, 200);
    const stored = await findUser(existingEmail);
    assert.ok(stored.user);
    const passwordHash = stored.user.passwordHash;
    const liveTokens = tokensFor(stored.data, stored.user.id);
    assert.equal(liveTokens.length, 1);

    useDelivery("", "1");
    const known = await registerRoute.POST(jsonRequest("http://localhost/api/auth/register", registerBody(existingEmail, ATTACKER_PASSWORD)));
    const knownBody = await known.json() as ApiBody;
    assert.equal(known.status, 503);
    assert.equal(knownBody.ok, false);
    assert.equal(knownBody.code, "EMAIL_DELIVERY_NOT_CONFIGURED");
    assert.equal(hasSessionCookie(known), false);
    const afterKnown = await findUser(existingEmail);
    assert.ok(afterKnown.user);
    assert.equal(afterKnown.user.status, "pending");
    assert.equal(afterKnown.user.passwordHash, passwordHash);
    assert.deepEqual(tokensFor(afterKnown.data, afterKnown.user.id), liveTokens);

    const email = uniqueEmail("unconfigured");
    const response = await registerRoute.POST(jsonRequest("http://localhost/api/auth/register", registerBody(email, FIRST_PASSWORD)));
    const body = await response.json() as ApiBody;
    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    assert.equal(body.code, "EMAIL_DELIVERY_NOT_CONFIGURED");
    assert.deepEqual(publicShape(knownBody), publicShape(body));
    assert.equal((await findUser(email)).user, undefined);
    assert.equal(hasSessionCookie(response), false);
  });

  test("resend send failure stays accepted and keeps the unused token hash", async () => {
    useDelivery("discard", "1");
    const email = uniqueEmail("resend-fail");
    const created = await registerRoute.POST(jsonRequest("http://localhost/api/auth/register", registerBody(email, FIRST_PASSWORD)));
    assert.equal(created.status, 200);
    const stored = await findUser(email);
    assert.ok(stored.user);
    assert.equal(stored.user.status, "pending");
    const file = productFile();
    const onDisk = JSON.parse(await readFile(file, "utf8")) as { verificationTokens: Array<{ userId: string; createdAt: string }> };
    const aged = new Date(Date.now() - 120_000).toISOString();
    for (const token of onDisk.verificationTokens) {
      if (token.userId === stored.user.id) token.createdAt = aged;
    }
    await writeFile(file, JSON.stringify(onDisk));
    const beforeResend = await findUser(email);
    assert.ok(beforeResend.user);
    const beforeTokens = tokensFor(beforeResend.data, beforeResend.user.id);
    assert.equal(beforeTokens.length, 1);
    const unusedHash = beforeTokens.filter((item) => !item.usedAt).map((item) => item.tokenHash);

    useDelivery("fail", "1");
    const response = await resendRoute.POST(jsonRequest("http://localhost/api/auth/resend-verification", { email, locale: "en-GB" }));
    const body = await response.json() as ApiBody;
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.data, { accepted: true });

    const afterResend = await findUser(email);
    assert.ok(afterResend.user);
    const afterTokens = tokensFor(afterResend.data, afterResend.user.id);
    assert.equal(afterTokens.length, beforeTokens.length);
    assert.deepEqual(afterTokens.filter((item) => !item.usedAt).map((item) => item.tokenHash), unusedHash);
  });

  test("a verification link is not stored for an account that became active before the commit", async () => {
    useDelivery("discard", "1");
    const email = uniqueEmail("resend-activated");
    const user = await store.registerUser({ email, password: FIRST_PASSWORD, locale: "en-GB" });
    await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
    const beforeCommit = tokensFor((await findUser(email)).data, user.id);
    assert.equal(await store.replaceLiveVerificationToken(user.id, "raw-token-after-activation"), false);
    const afterCommit = await findUser(email);
    assert.equal(afterCommit.user?.status, "active");
    assert.deepEqual(tokensFor(afterCommit.data, user.id), beforeCommit);
    assert.equal(tokensFor(afterCommit.data, user.id).some((item) => !item.usedAt), false);
  });

  test("resend of an unknown email matches the pending resend shape", async () => {
    useDelivery("discard", "1");
    const email = uniqueEmail("resend-known");
    const unknownEmail = uniqueEmail("resend-unknown");
    const created = await registerRoute.POST(jsonRequest("http://localhost/api/auth/register", registerBody(email, FIRST_PASSWORD)));
    assert.equal(created.status, 200);
    const pending = await resendRoute.POST(jsonRequest("http://localhost/api/auth/resend-verification", { email, locale: "en-GB" }));
    const missing = await resendRoute.POST(jsonRequest("http://localhost/api/auth/resend-verification", { email: unknownEmail, locale: "en-GB" }));
    const pendingBody = await pending.json() as ApiBody;
    const missingBody = await missing.json() as ApiBody;
    assert.equal(pending.status, 200);
    assert.equal(missing.status, 200);
    assert.notEqual(missing.status, 429);
    assert.notEqual(pending.status, 429);
    assert.equal(pendingBody.data?.accepted, true);
    assert.deepEqual(publicShape(missingBody), publicShape(pendingBody));
    assert.equal((await findUser(unknownEmail)).user, undefined);
  });

  test("verification disabled register still opens a session", async () => {
    useDelivery("", "0");
    const email = uniqueEmail("dev-session");
    const response = await registerRoute.POST(jsonRequest("http://localhost/api/auth/register", registerBody(email, FIRST_PASSWORD)));
    const body = await response.json() as ApiBody;
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data?.verificationRequired, false);
    assert.equal(hasSessionCookie(response), true);
  });
});

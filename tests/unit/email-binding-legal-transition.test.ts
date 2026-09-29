import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

const ORIGIN = "https://binding.example.test";

type StoreModule = typeof import("../../services/productStore");
type BindingToken = { userId: string; email: string; tokenHash: string; createdAt: string; usedAt: string | null };

const envSnapshot = { ...process.env };
const originalCwd = process.cwd();
let temp = "";
let relocated = false;
let bindingRoute: typeof import("../../app/api/auth/email-binding/request/route");
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

function productFile() {
  return path.join(process.cwd(), "data", "knowledge_system", "learning_guide", "product.json");
}

async function bindingTokens(userId: string) {
  const data = JSON.parse(await readFile(productFile(), "utf8")) as { emailBindingTokens: BindingToken[] };
  return data.emailBindingTokens.filter((item) => item.userId === userId);
}

async function ageBindingTokens(userId: string) {
  const data = JSON.parse(await readFile(productFile(), "utf8")) as { emailBindingTokens: BindingToken[] };
  const aged = new Date(Date.now() - 120_000).toISOString();
  for (const token of data.emailBindingTokens) {
    if (token.userId === userId) token.createdAt = aged;
  }
  await writeFile(productFile(), JSON.stringify(data));
}

async function restrictedWeChatSession(label: string) {
  sequence += 1;
  const user = await store.getOrCreateSocialUser({ provider: "wechat", providerSubject: `${label}:${sequence}:${Date.now()}` });
  const session = await store.createSession(user.id);
  assert.equal(await store.getUserBySessionToken(session.token), null);
  return { userId: user.id, cookie: `learning_guide_session=${session.token}` };
}

function bindingRequest(cookie: string, email: string) {
  return bindingRoute.POST(new Request(`${ORIGIN}/api/auth/email-binding/request`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: ORIGIN },
    body: JSON.stringify({ email, locale: "en-GB" })
  }));
}

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "lg-binding-legal-"));
  process.chdir(temp);
  relocated = true;
  Object.assign(process.env, { APP_ENV: "DEV", STORAGE_BACKEND: "local", EMAIL_DELIVERY: "discard", NEXT_PUBLIC_APP_URL: ORIGIN });
  delete process.env.DATABASE_URL;
  delete process.env.DATA_S3_BUCKET;
  delete process.env.SES_FROM_EMAIL;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  bindingRoute = await import("../../app/api/auth/email-binding/request/route");
  store = await import("../../services/productStore");
});

after(async () => {
  if (relocated) process.chdir(originalCwd);
  restoreEnv(envSnapshot);
  if (temp) await rm(temp, { recursive: true, force: true });
});

describe("email binding legal transition", { concurrency: false }, () => {
  test("a rejected binding mail stores no link and does not start the cooldown", async () => {
    const { userId, cookie } = await restrictedWeChatSession("binding-fail");
    const email = uniqueEmail("binding-fail");

    process.env.EMAIL_DELIVERY = "fail";
    const failed = await bindingRequest(cookie, email);
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { ok: false, code: "email_unavailable" });
    assert.deepEqual(await bindingTokens(userId), []);

    process.env.EMAIL_DELIVERY = "discard";
    const retry = await bindingRequest(cookie, email);
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), { ok: true, accepted: true, retryAfter: 60 });
    const stored = await bindingTokens(userId);
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.email, email);

    const cooling = await bindingRequest(cookie, email);
    assert.equal(cooling.status, 429);
    assert.deepEqual(await bindingTokens(userId), stored);
  });

  test("a rejected binding mail keeps the previously delivered link usable", async () => {
    const { userId, cookie } = await restrictedWeChatSession("binding-keep");
    const email = uniqueEmail("binding-keep");
    const live = await store.issueEmailBinding(userId, email);
    await ageBindingTokens(userId);
    const before = await bindingTokens(userId);

    process.env.EMAIL_DELIVERY = "fail";
    const failed = await bindingRequest(cookie, uniqueEmail("binding-other"));
    assert.equal(failed.status, 503);
    assert.deepEqual(await bindingTokens(userId), before);

    assert.deepEqual(await store.confirmEmailBinding(live.token), { userId, alreadyBound: false });
    process.env.EMAIL_DELIVERY = "discard";
  });

  test("the commit re-checks uniqueness and stores nothing when the email was taken meanwhile", async () => {
    const { userId } = await restrictedWeChatSession("binding-race");
    const email = uniqueEmail("binding-race");
    assert.deepEqual(await store.planEmailBinding(userId, email), { email });
    await store.registerUser({ email, password: "Test-password-123", nickname: "Test" });
    await assert.rejects(store.commitEmailBinding(userId, email, "raw-token-for-race"), /email_in_use/);
    assert.deepEqual(await bindingTokens(userId), []);
  });
});

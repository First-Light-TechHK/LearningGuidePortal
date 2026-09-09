import { expect, test } from "playwright/test";
import { mkdtemp, readFile, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { NextRequest } from "next/server";

test.describe.configure({ mode: "serial" });
const originalCwd = process.cwd();
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");
let oauth: typeof import("../../services/oauthService");
let callback: typeof import("../../app/api/auth/wechat/callback/route");

test.beforeAll(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "learning-guide-wechat-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  process.env.APP_ENV = "DEV";
  process.env.LOCAL_SOCIAL_LOGIN = "0";
  process.env.WECHAT_APP_ID = "wx-test";
  process.env.WECHAT_APP_SECRET = "test-only-secret";
  process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  process.env.NEXT_PUBLIC_APP_URL = "https://login.example.test";
  store = await import("../../services/productStore");
  oauth = await import("../../services/oauthService");
  callback = await import("../../app/api/auth/wechat/callback/route");
});
test.afterEach(() => { globalThis.fetch = originalFetch; });
test.afterAll(async () => {
  process.chdir(originalCwd);
  process.env = originalEnv;
  // mkdtemp above owns this exact directory; never delete the repository data.
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) await rm(isolatedCwd, { recursive: true, force: true });
});

function provider(openid: string, unionid?: string) {
  globalThis.fetch = async (input, init) => {
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeTruthy();
    const url = new URL(String(input));
    return Response.json(url.pathname.endsWith("access_token")
      ? { access_token: "token", openid, ...(unionid ? { unionid } : {}) }
      : { openid, nickname: "Learner", ...(unionid ? { unionid } : {}) });
  };
}
function request(transaction: ReturnType<typeof oauth.makeOAuthState>, query = "code=test-code") {
  return new NextRequest(`https://login.example.test/api/auth/wechat/callback?state=${transaction.state}&${query}`, {
    headers: { cookie: `${oauth.OAUTH_STATE_COOKIE}=${transaction.cookieValue}` },
  });
}
function transaction() { return oauth.makeOAuthState("zh-CN", "/zh-CN/account/my-learning", "wechat"); }
function expectCleared(response: Awaited<ReturnType<typeof callback.GET>>) {
  expect(response.cookies.get(oauth.OAUTH_STATE_COOKIE)?.maxAge).toBe(0);
  expect(response.status).toBe(303);
  expect(response.headers.get("cache-control")).toBe("no-store");
}

test("stable app/OpenID identity survives UnionID appearing and disappearing; email stays absent", async () => {
  const ids: string[] = [];
  for (const union of [undefined, "union-one", undefined]) {
    provider("openid-one", union);
    const profile = await oauth.fetchWeChatProfile("code");
    expect(profile.subject).toBe("wx-test:openid-one");
    expect(profile.email).toBeNull();
    const user = await store.getOrCreateSocialUser({ provider: "wechat", providerSubject: profile.subject, wechat: profile });
    expect(user.email).toBeNull();
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.role).toBe("student");
    ids.push(user.id);
    const session = await store.createSession(user.id);
    expect((await store.getUserBySessionToken(session.token))?.id).toBe(user.id);
  }
  expect(new Set(ids).size).toBe(1);
  const users = await Promise.all(Array.from({ length: 4 }, () => store.getOrCreateSocialUser({
    provider: "wechat", providerSubject: "wx-test:concurrent", wechat: { appId: "wx-test", openId: "concurrent" },
  })));
  expect(new Set(users.map(user => user.id)).size).toBe(1);
  expect(users[0].id).not.toBe(ids[0]);
  expect(await store.getUserBySessionToken(undefined)).toBeNull();
  expect((await store.requestPasswordReset("wechat-openid-one@local.invalid")).token).toBeNull();
});

test("legacy subject and placeholder email migrate without changing userId; collisions fail closed", async () => {
  const user = await store.getOrCreateSocialUser({ provider: "wechat", providerSubject: "legacy-openid" });
  const file = path.join(isolatedCwd, "data/knowledge_system/learning_guide/product.json");
  const data = JSON.parse(await readFile(file, "utf8"));
  const legacy = data.users.find((item: { id: string }) => item.id === user.id);
  legacy.email = "wechat-legacy-openid@local.invalid";
  legacy.emailVerifiedAt = new Date().toISOString();
  await writeFile(file, JSON.stringify(data));
  const migrated = await store.getOrCreateSocialUser({ provider: "wechat", providerSubject: "wx-test:legacy-openid", wechat: { appId: "wx-test", openId: "legacy-openid" } });
  expect(migrated.id).toBe(user.id);
  expect(migrated.email).toBeNull();
  expect(migrated.emailVerifiedAt).toBeNull();
  await store.getOrCreateSocialUser({ provider: "wechat", providerSubject: "legacy-union" });
  await expect(store.getOrCreateSocialUser({ provider: "wechat", providerSubject: "wx-test:legacy-openid", wechat: { appId: "wx-test", openId: "legacy-openid", unionId: "legacy-union" } })).rejects.toMatchObject({ code: "account_conflict" });
});

test("provider rejects HTTP/business errors, malformed data, mismatched identity and transport failure", async () => {
  for (const response of [() => Response.json({ errcode: 40029 }), () => new Response("bad-json"), () => Response.json({}, { status: 503 }), () => Response.json({ access_token: "token", openid: 42 })]) {
    globalThis.fetch = async () => response();
    await expect(oauth.fetchWeChatProfile("code")).rejects.toMatchObject({ code: "exchange" });
  }
  globalThis.fetch = async () => { throw new Error("secret must not escape"); };
  await expect(oauth.fetchWeChatProfile("code")).rejects.toThrow(/^exchange$/);
  globalThis.fetch = async input => Response.json(String(input).includes("access_token?")
    ? { access_token: "token", openid: "one", unionid: "union-one" } : { openid: "two" });
  await expect(oauth.fetchWeChatProfile("code")).rejects.toMatchObject({ code: "profile" });
  globalThis.fetch = async input => Response.json(String(input).includes("access_token?")
    ? { access_token: "token", openid: "one", unionid: "union-one" } : { openid: "one", unionid: "union-two" });
  await expect(oauth.fetchWeChatProfile("code")).rejects.toMatchObject({ code: "profile" });
});

test("callback establishes usable session and clears cookie; replay without transaction fails", async () => {
  provider("callback-user");
  const response = await callback.GET(request(transaction()));
  expectCleared(response);
  expect(response.headers.get("location")).toBe("https://login.example.test/zh-CN/account/my-learning");
  const cookie = response.cookies.get("learning_guide_session");
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax" });
  expect((await store.getUserBySessionToken(cookie?.value))?.email).toBeNull();
  const replay = await callback.GET(new NextRequest("https://login.example.test/api/auth/wechat/callback?code=test-code&state=old"));
  expectCleared(replay);
  expect(replay.cookies.has("learning_guide_session")).toBe(false);
});

test("callback errors always clear transaction cookie and never create a session", async () => {
  const cases = [request(transaction(), ""), request(transaction(), "error=access_denied"), request({ ...transaction(), state: "tampered" }), request({ ...transaction(), cookieValue: "tampered" })];
  const realNow = Date.now;
  Date.now = () => realNow() - 700_000;
  let expired: ReturnType<typeof transaction>;
  try { expired = transaction(); } finally { Date.now = realNow; }
  cases.push(request(expired));
  globalThis.fetch = async () => { throw new Error("must not call provider for invalid transaction"); };
  for (const input of cases) {
    const response = await callback.GET(input);
    expectCleared(response);
    expect(response.cookies.has("learning_guide_session")).toBe(false);
    expect(response.headers.get("location")).toMatch(/oauthError=(state|cancelled)/);
  }
  const failure = await callback.GET(request(transaction()));
  expectCleared(failure);
  expect(failure.headers.get("location")).toContain("oauthError=wechat");
});

test("disabled account is rejected and hostile returnTo stays on the configured origin", async () => {
  const user = await store.getOrCreateSocialUser({ provider: "wechat", providerSubject: "wx-test:disabled" });
  const file = path.join(isolatedCwd, "data/knowledge_system/learning_guide/product.json");
  const data = JSON.parse(await readFile(file, "utf8"));
  data.users.find((item: { id: string }) => item.id === user.id).status = "disabled";
  await writeFile(file, JSON.stringify(data));
  provider("disabled");
  const response = await callback.GET(request(transaction()));
  expectCleared(response);
  expect(response.headers.get("location")).toContain("oauthError=disabled");
  expect(response.cookies.has("learning_guide_session")).toBe(false);
  provider("safe-redirect");
  for (const target of ["//evil.test", "/\\evil.test", "https://evil.test", "/\n/evil.test"]) {
    const response = await callback.GET(request(oauth.makeOAuthState("en-GB", target, "wechat")));
    expect(new URL(response.headers.get("location")!).origin).toBe("https://login.example.test");
  }
});

test("login entry uses real QR authorization and an HTTPS transaction cookie", async () => {
  const route = await import("../../app/api/auth/wechat/route");
  const response = await route.GET(new Request("https://login.example.test/api/auth/wechat?locale=zh-CN"));
  const target = new URL(response.headers.get("location")!);
  expect(target.origin + target.pathname).toBe("https://open.weixin.qq.com/connect/qrconnect");
  expect(target.searchParams.get("scope")).toBe("snsapi_login");
  expect(target.searchParams.get("redirect_uri")).toBe("https://login.example.test/api/auth/wechat/callback");
  expect(response.cookies.get(oauth.OAUTH_STATE_COOKIE)).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax" });
});

test("WeChat authentication does not grant missing or expired course access", async () => {
  provider("entitlement-user");
  const response = await callback.GET(request(transaction()));
  const user = await store.getUserBySessionToken(response.cookies.get("learning_guide_session")?.value);
  expect(user).toBeTruthy();
  expect((await store.checkEntitlement(user!.id, "test-course")).allowed).toBe(false);
  const file = path.join(isolatedCwd, "data/knowledge_system/learning_guide/product.json");
  const data = JSON.parse(await readFile(file, "utf8"));
  data.entitlements.push({ id: "expired", userId: user!.id, courseId: "test-course", state: "active", source: "subscription", validTo: "2000-01-01T00:00:00Z" });
  await writeFile(file, JSON.stringify(data));
  expect((await store.checkEntitlement(user!.id, "test-course")).allowed).toBe(false);
});

test("paid, trial and upgrade Checkout omit absent email and retain user identity metadata", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_fake_only";
  const stripe = await import("../../services/stripeClient");
  const sessions = stripe.getStripe().checkout.sessions;
  const original = sessions.create;
  const captured: Array<Record<string, unknown>> = [];
  sessions.create = (async (params: Record<string, unknown>) => {
    captured.push(params);
    return { id: "cs_test", url: "https://checkout.example.test" };
  }) as typeof sessions.create;
  try {
    const input = { origin: "https://login.example.test", locale: "en-GB" as const, userEmail: null, price: { stripePriceId: "price_test", lookupKey: "test", amountMinor: 100, currency: "usd" as const, termMonths: 6 as const },
      userId: "wechat-user", orderId: "order", quoteId: "quote", planId: "plan", courseId: "course",
      planName: "Plan", amountMinor: 100, currency: "usd", termMonths: 6 };
    await stripe.createHostedCheckout(input);
    await stripe.createHostedTrialCheckout(input);
    await stripe.createHostedUpgradeCheckout({ ...input, sourceSubscriptionId: "source-subscription" });
    for (const params of captured) {
      expect(params.customer_email).toBeUndefined();
      expect(params.metadata).toMatchObject({ userId: "wechat-user" });
    }
    expect(captured).toHaveLength(3);
  } finally { sessions.create = original; }
});

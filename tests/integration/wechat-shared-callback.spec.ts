import { expect, test } from "playwright/test";
import { NextRequest } from "next/server";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GET as entry } from "../../app/api/auth/wechat/route";
import { GET as complete } from "../../app/api/auth/wechat/complete/route";
import { POST as redeem } from "../../app/api/auth/wechat/redeem/route";
import { middleware } from "../../middleware";
import { makeCentralRequest, makeHandoffCookie, readCentralRequest, readHandoffCookie, WECHAT_HANDOFF_COOKIE } from "../../services/wechatHandoff";

test.describe.configure({ mode: "serial" });
const previous = { ...process.env };
test.beforeAll(() => {
  process.env.APP_ENV = "DEV";
  process.env.NEXT_PUBLIC_APP_URL = "https://www.example.test";
  process.env.WECHAT_AUTH_ORIGIN = "https://uat.example.test";
  process.env.WECHAT_DEV_ORIGIN = "https://www.example.test";
  process.env.WECHAT_SIT_ORIGIN = "https://sit.example.test";
  process.env.WECHAT_UAT_ORIGIN = "https://uat.example.test";
  process.env.SESSION_SECRET = "dev-session-secret-for-integration-tests";
  process.env.WECHAT_SHARED_STATE_SECRET = "shared-state-secret-for-integration-tests";
  process.env.WECHAT_APP_ID = "wx-test";
  process.env.WECHAT_APP_SECRET = "test-only-secret";
  process.env.WECHAT_DEV_HANDOFF_SECRET = "dev-handoff-secret-for-integration-tests";
});
test.afterAll(() => { process.env = previous; });

test("DEV apex permanently redirects to www, preserving path and query", () => {
  const response = middleware(new NextRequest("https://example.test/en-GB/portal/sign-in?returnTo=%2Fen-GB%2Faccount"));
  expect(response.status).toBe(308);
  expect(response.headers.get("location")).toBe("https://www.example.test/en-GB/portal/sign-in?returnTo=%2Fen-GB%2Faccount");
});

test("handoff service rejects modified and expired browser or central state", () => {
  const handoff = makeHandoffCookie("//evil.example/redirect");
  expect(readHandoffCookie(handoff.value)?.returnTo).toBe("/en-GB/account/my-learning");
  const signed = makeCentralRequest("DEV", handoff.nonce, "/en-GB/account/my-learning");
  expect(readCentralRequest(`${signed}tampered`)).toBeNull();
  expect(readHandoffCookie(`${handoff.value}tampered`)).toBeNull();
  const realNow = Date.now;
  Date.now = () => realNow() + 11 * 60_000;
  try {
    expect(readCentralRequest(signed)).toBeNull();
    expect(readHandoffCookie(handoff.value)).toBeNull();
  } finally { Date.now = realNow; }
});

test("DEV login creates a host-only transaction and routes to the UAT origin", async () => {
  const response = await entry(new Request("https://www.example.test/api/auth/wechat?locale=zh-CN&returnTo=%2Fzh-CN%2Faccount%2Fmy-learning"));
  expect(response.status).toBe(303);
  const cookie = response.cookies.get(WECHAT_HANDOFF_COOKIE);
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true });
  expect(cookie?.domain).toBeUndefined();
  const target = new URL(response.headers.get("location")!);
  expect(target.origin).toBe("https://uat.example.test");
  const state = readCentralRequest(target.searchParams.get("request"));
  expect(state).toMatchObject({ env: "DEV", returnTo: "/zh-CN/account/my-learning" });
  expect(readHandoffCookie(cookie?.value)?.nonce).toBe(state?.nonce);
});

test("SIT also starts through UAT while retaining its own return target", async () => {
  process.env.APP_ENV = "SIT";
  process.env.NEXT_PUBLIC_APP_URL = "https://sit.example.test";
  try {
    const response = await entry(new Request("https://sit.example.test/api/auth/wechat?returnTo=%2Fen-GB%2Faccount%2Fmy-learning"));
    const target = new URL(response.headers.get("location")!);
    expect(target.origin).toBe("https://uat.example.test");
    expect(readCentralRequest(target.searchParams.get("request"))?.env).toBe("SIT");
    expect(response.cookies.get(WECHAT_HANDOFF_COOKIE)?.domain).toBeUndefined();
  } finally {
    process.env.APP_ENV = "DEV";
    process.env.NEXT_PUBLIC_APP_URL = "https://www.example.test";
  }
});

test("UAT starts a QR flow with only its approved callback domain", async () => {
  const handoff = makeHandoffCookie("/zh-CN/account/my-learning");
  const signed = makeCentralRequest("DEV", handoff.nonce, "/zh-CN/account/my-learning");
  process.env.APP_ENV = "UAT";
  process.env.NEXT_PUBLIC_APP_URL = "https://uat.example.test";
  try {
    const response = await entry(new Request(`https://uat.example.test/api/auth/wechat?locale=zh-CN&request=${encodeURIComponent(signed)}`));
    const target = new URL(response.headers.get("location")!);
    expect(target.host).toBe("open.weixin.qq.com");
    expect(target.searchParams.get("redirect_uri")).toBe("https://uat.example.test/api/auth/wechat/callback");
    expect(response.cookies.get("learning_guide_oauth_state")?.domain).toBeUndefined();
    expect(response.cookies.get("learning_guide_oauth_state")?.secure).toBe(true);
  } finally {
    process.env.APP_ENV = "DEV";
    process.env.NEXT_PUBLIC_APP_URL = "https://www.example.test";
  }
});

test("tampered request, missing browser cookie and unauthorised redemption fail closed", async () => {
  process.env.APP_ENV = "UAT";
  process.env.NEXT_PUBLIC_APP_URL = "https://uat.example.test";
  try {
    const invalid = await entry(new Request("https://uat.example.test/api/auth/wechat?request=invalid&locale=en-GB"));
    expect(invalid.status).toBe(400);
    const denied = await redeem(new Request("https://uat.example.test/api/auth/wechat/redeem", { method: "POST", body: JSON.stringify({ ticket: "fake" }) }));
    expect(denied.status).toBe(401);
  } finally {
    process.env.APP_ENV = "DEV";
    process.env.NEXT_PUBLIC_APP_URL = "https://www.example.test";
  }
  const missing = await complete(new NextRequest("https://www.example.test/api/auth/wechat/complete?ticket=fake"));
  expect(missing.status).toBe(303);
  expect(missing.headers.get("location")).toContain("oauthError=state");
  expect(missing.cookies.has("learning_guide_session")).toBe(false);
});

test("target environment creates its own restricted session; duplicate ticket fails", async () => {
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), "learning-guide-wechat-shared-"));
  process.chdir(directory);
  process.env.STORAGE_BACKEND = "local";
  const handoff = makeHandoffCookie("/en-GB/account/my-learning");
  let redeemed = false;
  globalThis.fetch = async (_input, init) => {
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "x-wechat-environment": "DEV" });
    if (redeemed) return Response.json({ ok: false }, { status: 400 });
    redeemed = true;
    return Response.json({ ok: true, result: { nonce: handoff.nonce, profile: {
      appId: "wx-test", openId: "shared-user", subject: "wx-test:shared-user", email: null,
    } } });
  };
  try {
    const url = "https://www.example.test/api/auth/wechat/complete?ticket=opaque-ticket";
    const request = () => new NextRequest(url, { headers: { cookie: `${WECHAT_HANDOFF_COOKIE}=${handoff.value}` } });
    const first = await complete(request());
    expect(first.headers.get("location")).toContain("/en-GB/portal/bind-email");
    expect(first.cookies.get("learning_guide_session")?.httpOnly).toBe(true);
    const second = await complete(request());
    expect(second.headers.get("location")).toContain("oauthError=state");
    expect(second.cookies.has("learning_guide_session")).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    delete process.env.STORAGE_BACKEND;
    if (path.dirname(directory) === tmpdir()) await rm(directory, { recursive: true, force: true });
  }
});

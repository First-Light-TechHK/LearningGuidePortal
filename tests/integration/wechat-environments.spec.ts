import { expect, test } from "playwright/test";
import "./helpers/preload-native-modules";
import { NextRequest } from "next/server";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GET as entry } from "../../app/api/auth/wechat/route";
import { GET as callback } from "../../app/api/auth/wechat/callback/route";
import { OAUTH_STATE_COOKIE, readOAuthState, wechatEnabled } from "../../services/oauthService";
import { runtimeConfiguration } from "../../services/runtimeConfig";
import { getUserBySessionToken } from "../../services/productStore";
import { middleware } from "../../middleware";

test.describe.configure({ mode: "serial" });
const previous = { ...process.env }, previousFetch = globalThis.fetch, previousCwd = process.cwd();
let directory: string;
test.beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lg-wechat-direct-"));
  process.chdir(directory);
  Object.assign(process.env, {
    STORAGE_BACKEND: "local", LOCAL_SOCIAL_LOGIN: "0",
    // Stale deployment settings must neither enable nor route authentication.
    WECHAT_AUTH_ORIGIN: "https://uat-relay.example.test",
    WECHAT_DEV_ORIGIN: "https://www.obsolete.example.test",
    WECHAT_SIT_ORIGIN: "https://sit-obsolete.example.test",
    WECHAT_UAT_ORIGIN: "https://uat-relay.example.test",
    WECHAT_SHARED_STATE_SECRET: "obsolete-shared-state-secret-for-tests",
    WECHAT_DEV_HANDOFF_SECRET: "obsolete-dev-handoff-secret-for-tests",
    WECHAT_SIT_HANDOFF_SECRET: "obsolete-sit-handoff-secret-for-tests",
    WECHAT_UAT_HANDOFF_SECRET: "obsolete-uat-handoff-secret-for-tests",
  });
});
test.afterEach(() => { globalThis.fetch = previousFetch; });
test.afterAll(async () => {
  process.chdir(previousCwd);
  process.env = previous;
  if (directory && path.dirname(directory) === tmpdir()) await rm(directory, { recursive: true, force: true });
});

const environments = [
  { env: "DEV", origin: "https://www.example.test", appId: "wx-dev" },
  { env: "SIT", origin: "https://sit.example.test", appId: "wx-sit" },
  { env: "UAT", origin: "https://uat.example.test", appId: "wx-uat" },
  { env: "PPE/PROD", origin: "https://prod.example.test", appId: "wx-prod" },
];
function configure(environment: typeof environments[number]) {
  Object.assign(process.env, {
    APP_ENV: environment.env, NEXT_PUBLIC_APP_URL: environment.origin,
    WECHAT_APP_ID: environment.appId, WECHAT_APP_SECRET: `${environment.appId}-test-secret`,
    SESSION_SECRET: `${environment.appId}-session-secret-at-least-32-characters`,
  });
}

for (const environment of environments) for (const locale of ["en-GB", "zh-CN"]) {
  test(`${environment.env} ${locale} exchanges its own AppID directly and creates a local restricted Session`, async () => {
    configure(environment);
    const returnTo = `/${locale}/account/my-learning?tab=courses`;
    const response = await entry(new Request(`${environment.origin}/api/auth/wechat?${new URLSearchParams({ locale, returnTo })}`));
    const provider = new URL(response.headers.get("location")!);
    expect(provider.origin + provider.pathname).toBe("https://open.weixin.qq.com/connect/qrconnect");
    expect(provider.searchParams.get("appid")).toBe(environment.appId);
    expect(provider.searchParams.get("redirect_uri")).toBe(`${environment.origin}/api/auth/wechat/callback`);
    const cookie = response.cookies.get(OAUTH_STATE_COOKIE)!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    expect(cookie.domain).toBeUndefined();
    expect(response.cookies.getAll()).toHaveLength(1);
    expect(readOAuthState(cookie.value, provider.searchParams.get("state"), "wechat")).toMatchObject({ locale, returnTo });
    const calls: string[] = [];
    globalThis.fetch = async input => {
      const target = new URL(String(input));
      expect(target.origin).toBe("https://api.weixin.qq.com");
      calls.push(target.pathname);
      if (target.pathname.endsWith("access_token")) {
        expect(target.searchParams.get("appid")).toBe(environment.appId);
        expect(target.searchParams.get("secret")).toBe(`${environment.appId}-test-secret`);
        return Response.json({ access_token: "test-token", openid: "same-open-id" });
      }
      return Response.json({ openid: "same-open-id", nickname: "Learner" });
    };
    const completed = await callback(new NextRequest(`${environment.origin}/api/auth/wechat/callback?${new URLSearchParams({ state: provider.searchParams.get("state")!, code: "test-code" })}`, {
      headers: { cookie: `${OAUTH_STATE_COOKIE}=${cookie.value}` },
    }));
    expect(calls).toEqual(["/sns/oauth2/access_token", "/sns/userinfo"]);
    expect(completed.status).toBe(303);
    expect(completed.headers.get("location")).toBe(`${environment.origin}/${locale}/portal/bind-email?returnTo=${encodeURIComponent(returnTo)}`);
    expect(completed.cookies.get(OAUTH_STATE_COOKIE)?.maxAge).toBe(0);
    const session = completed.cookies.get("learning_guide_session")!;
    expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax" });
    expect(session.domain).toBeUndefined();
    expect(await getUserBySessionToken(session.value, true)).toMatchObject({ email: null, emailVerifiedAt: null });
    expect(await getUserBySessionToken(session.value)).toBeNull();
    expect(runtimeConfiguration().authentication.wechat).toBe("configured");
  });
}

test("old relay settings cannot enable login or make missing local credentials healthy", async () => {
  for (const environment of environments) {
    configure(environment);
    delete process.env.WECHAT_APP_ID;
    delete process.env.WECHAT_APP_SECRET;
    expect(wechatEnabled()).toBe(false);
    const health = runtimeConfiguration();
    expect(health.authentication.wechat).toBe("missing");
    if (environment.env !== "DEV") expect(health.missing).toContain("WECHAT_APP_ID + WECHAT_APP_SECRET");
    const response = await entry(new Request(`${environment.origin}/api/auth/wechat`));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "WECHAT_NOT_CONFIGURED" });
    expect(response.cookies.getAll()).toHaveLength(0);
  }
});

test("a different environment's state cannot create a Session or trigger provider traffic", async () => {
  configure(environments[0]);
  const started = await entry(new Request(`${environments[0].origin}/api/auth/wechat`));
  const state = new URL(started.headers.get("location")!).searchParams.get("state")!;
  const cookie = started.cookies.get(OAUTH_STATE_COOKIE)!.value;
  configure(environments[1]);
  globalThis.fetch = async () => { throw new Error("must not exchange invalid state"); };
  const denied = await callback(new NextRequest(`${environments[1].origin}/api/auth/wechat/callback?${new URLSearchParams({ state, code: "test-code" })}`, {
    headers: { cookie: `${OAUTH_STATE_COOKIE}=${cookie}` },
  }));
  expect(denied.headers.get("location")).toContain(`${environments[1].origin}/en-GB/portal/sign-in?oauthError=state`);
  expect(denied.cookies.has("learning_guide_session")).toBe(false);
});

test("obsolete DEV relay origin no longer redirects unrelated Portal visits", () => {
  configure(environments[0]);
  const response = middleware(new NextRequest("https://obsolete.example.test/en-GB/portal/sign-in"));
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("x-middleware-next")).toBe("1");
});

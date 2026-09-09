import { expect, test } from "playwright/test";
import { GET as google } from "../../app/api/auth/google/route";
import { GET as wechat } from "../../app/api/auth/wechat/route";
import { OAUTH_STATE_COOKIE, readOAuthState } from "../../services/oauthService";

const previous = { ...process.env };
test.beforeAll(() => {
  Object.assign(process.env, {
    APP_ENV: "DEV", LOCAL_SOCIAL_LOGIN: "0",
    NEXT_PUBLIC_APP_URL: "https://www.example.test",
    SESSION_SECRET: "test-only-session-secret-32-characters-long",
    GOOGLE_CLIENT_ID: "test-google", GOOGLE_CLIENT_SECRET: "test-only",
    WECHAT_APP_ID: "wx-test", WECHAT_APP_SECRET: "test-only",
  });
});
test.afterAll(() => { process.env = previous; });

for (const [provider, handler] of [["google", google], ["wechat", wechat]] as const) {
  for (const host of ["example.test", "www.example.test", "service.awsapprunner.com"]) {
    test(provider + " first visit from " + host + " binds cookie to callback host without consent", async () => {
      const path = "/api/auth/" + provider + "?locale=zh-CN&returnTo=%2Fzh-CN%2Faccount%2Fmy-learning";
      let response = await handler(new Request("https://" + host + path));
      if (host !== "www.example.test") {
        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toBe("https://www.example.test" + path);
        expect(response.cookies.get(OAUTH_STATE_COOKIE)).toBeUndefined();
        response = await handler(new Request(response.headers.get("location")!));
      }
      const target = new URL(response.headers.get("location")!);
      expect(target.searchParams.get("redirect_uri")).toBe("https://www.example.test/api/auth/" + provider + "/callback");
      const cookie = response.cookies.get(OAUTH_STATE_COOKIE)!;
      expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
      expect(cookie.domain).toBeUndefined();
      expect(readOAuthState(cookie.value, target.searchParams.get("state"), provider)?.locale).toBe("zh-CN");
      expect(response.headers.get("cache-control")).toBe("no-store");
    });
  }
  test(provider + " respects proxy host and does not loop on internal HTTP", async () => {
    const response = await handler(new Request("http://0.0.0.0:8080/api/auth/" + provider, {
      headers: { "x-forwarded-host": "www.example.test", "x-forwarded-proto": "https" },
    }));
    expect(response.cookies.has(OAUTH_STATE_COOKIE)).toBe(true);
  });
}


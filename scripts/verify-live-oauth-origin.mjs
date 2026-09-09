import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";

// Real browser cookies and live callbacks; provider consent is deliberately cancelled.
// No user accounts are created and no Google/WeChat credentials are used by this script.
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch({
    ...(process.env.BROWSER_PROXY ? { proxy: { server: process.env.BROWSER_PROXY } } : {}),
  });
  try {
    for (const host of ["ilovelearningguide.com", "www.ilovelearningguide.com"]) {
      for (const preference of [null, "essential", "optional"]) {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto("https://" + host + "/en-GB/portal/sign-in");
        if (preference) {
          await page.locator(".cookie-consent-actions button").nth(preference === "essential" ? 0 : 1).click();
        }
        let authorization;
        await page.route("https://accounts.google.com/**", async route => {
          authorization = new URL(route.request().url());
          await route.fulfill({ contentType: "text/html", body: "<p>Provider boundary</p>" });
        });
        await page.locator('a[href^="/api/auth/google?"]').click();
        await page.waitForURL("https://accounts.google.com/**");
        assert(authorization);
        const callback = new URL(authorization.searchParams.get("redirect_uri"));
        const cookie = (await context.cookies(callback.href)).find(c => c.name === "learning_guide_oauth_state");
        assert(cookie, "Callback host must receive the transaction cookie");
        assert.equal(cookie.domain, callback.hostname);
        assert(cookie.httpOnly && cookie.secure);
        callback.searchParams.set("state", authorization.searchParams.get("state"));
        callback.searchParams.set("error", "access_denied");
        await page.goto(callback.href);
        assert.equal(new URL(page.url()).searchParams.get("oauthError"), "google", "Valid state reaches consent cancellation handling");
        assert(!(await context.cookies()).some(c => c.name === "learning_guide_oauth_state"), "Callback clears transaction");
        console.log(JSON.stringify({ browser: name, host, preference: preference || "unanswered", passed: true }));
        await context.close();
      }
    }
  } finally { await browser.close(); }
}

import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";

const base = process.env.BASE_URL || "http://127.0.0.1:3011";
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
    const api = context.request;
    const config = await (await api.get(`${base}/api/health/config`)).json();
    assert.equal(config.environment, "DEV"); assert.equal(config.authentication.emailVerification, "disabled");
    const email = `auth-layout.${name}.${Date.now()}@example.test`;
    const password = "TestPass123!";
    assert.equal((await api.post(`${base}/api/auth/register`, { data: { email, password, nickname: "Auth Test" } })).status(), 200);
    await api.post(`${base}/api/auth/logout`);
    const page = await context.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    for (const locale of ["en-GB", "zh-CN"]) {
      const destination = `/${locale}/pricing?planId=european-humanities-pc-6`;
      await page.goto(`${base}/${locale}/portal/sign-in?returnTo=${encodeURIComponent(destination)}`, { waitUntil: "networkidle" });
      await page.locator('input[type="email"]').fill(email);
      await page.locator(".auth-entry-form > button").click();
      await page.waitForURL(url => url.searchParams.get("step") === "password");
      assert.equal(new URL(page.url()).searchParams.get("returnTo"), destination);
      await page.setViewportSize({ width: 1440, height: 1024 });
      await page.evaluate(() => document.fonts.ready);
      const form = page.locator(".auth-credential-form");
      const rect = await form.boundingBox();
      assert.equal(rect.x, 448.5); assert.equal(rect.y, 311); assert.equal(rect.width, 448);
      assert.equal(rect.height, 464);
      const providers = await form.locator(".auth-provider-links").boundingBox();
      assert.equal(providers.y, 701); assert.equal(providers.height, 32);
      const passwordInput = form.locator('input[autocomplete="current-password"]');
      await passwordInput.fill(password);
      await form.locator(".auth-password-toggle").click();
      assert.equal(await passwordInput.getAttribute("type"), "text");
      await form.locator(".auth-password-toggle").click();
      assert.equal(await passwordInput.getAttribute("type"), "password");
      await page.screenshot({ path: `/tmp/lg-auth-${name}-${locale}.png`, fullPage: true });
      for (const width of [768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      }
      await form.locator('input[type="checkbox"]').check();
      await form.locator(".auth-submit").click();
      await page.waitForURL(`${base}${destination}`);
      const cookies = await context.cookies();
      assert.ok(cookies.find(cookie => cookie.name === "learning_guide_session").expires > Date.now() / 1000 + 86400);
      await api.post(`${base}/api/auth/logout`);
      const sessionOnly = await api.post(`${base}/api/auth/login`, { data: { email, password, rememberMe: false } });
      assert.equal(sessionOnly.status(), 200);
      assert.doesNotMatch(sessionOnly.headers()["set-cookie"], /max-age|expires=/i);
      await api.post(`${base}/api/auth/logout`);
    }
    await page.goto(`${base}/en-GB/portal/sign-in?step=password&returnTo=${encodeURIComponent("/\\example.com")}`);
    const href = await page.locator(".portal-auth-heading a").getAttribute("href");
    assert.equal(new URL(href, base).searchParams.get("returnTo"), "/en-GB/account/my-learning");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ browser: name, passed: true, emailFirst: true, passwordToggle: true, selectedPlanRetained: true, rememberMe: true }));
  } finally { await browser.close(); }
}

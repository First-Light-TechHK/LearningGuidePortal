import { chromium, firefox, webkit } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = process.env.BASE_URL || "http://127.0.0.1:3011";
const out = "/tmp/learning-guide-ui-verification";
await fs.mkdir(out, { recursive: true });
const results = [];
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
 if (process.env.BROWSER && process.env.BROWSER !== name) continue;
 const browser = await engine.launch({ headless: true });
 try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + "/en-GB/portal");
  assert.equal(await page.locator(".portal-banner-content a").count(), 1);
  assert.equal(await page.locator(".portal-banner-dots button").count(), 3);
  assert.equal(await page.locator(".account-menu-trigger").count(), 0);
  const cardEnd = await page.locator(".portal-course-grid").boundingBox();
  const explore = await page.locator(".portal-explore-more").boundingBox();
  assert.ok(explore.y >= cardEnd.y + cardEnd.height);
  await page.goto(base + "/en-GB/portal/sign-up");
  await page.getByLabel("Name", { exact: true }).fill("Design Test");
  await page.getByLabel("Email", { exact: true }).fill("ui." + name + "." + Date.now() + "@example.test");
  await page.getByLabel("Password", { exact: true }).fill("TestPass123!");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.waitForURL("**/en-GB/account/my-learning");
  for (const locale of ["en-GB", "zh-CN"]) {
   for (const route of ["pricing", "portal/courses", "account/my-learning", "account/my-learning/settings", "account/my-learning/notifications", "account/my-learning/subscription"]) {
    console.log(`${name}: ${locale}/${route}`);
    await page.goto(base + "/" + locale + "/" + route);
    await page.locator(".account-menu-trigger").waitFor();
    for (const width of [1440, 768, 390, 320]) {
     await page.setViewportSize({ width, height: 1000 });
     await page.evaluate(async () => { await document.fonts.ready; await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
     const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
     if (overflow > 1) {
      console.log(await page.evaluate(() => Array.from(document.querySelectorAll("body *")).map((e) => ({ tag: e.tagName, cls: e.className, right: e.getBoundingClientRect().right, text: (e.textContent || "").slice(0, 60) })).filter((e) => e.right > window.innerWidth).slice(0, 12)));
      await page.screenshot({ path: out + "/overflow-" + name + ".png", fullPage: true });
     }
     assert.ok(overflow <= 1, name + " " + locale + " " + route + " " + width + " overflow=" + overflow);
     if (width === 1440 && route.startsWith("account")) {
      const sidebar = await page.locator(".account-nav").boundingBox();
      assert.equal(Math.round(sidebar.width), 280);
     }
    }
    if (locale === "en-GB") await page.screenshot({ path: out + "/" + name + "-" + route.replaceAll("/", "-") + ".png", fullPage: true });
   }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base + "/en-GB/account/my-learning/settings");
  assert.equal(await page.getByLabel("Country", { exact: true }).getAttribute("required"), "");
  await page.locator(".settings-interest-menu summary").click();
  assert.equal(await page.locator(".settings-interest-menu input[type=checkbox]").count(), 7);
  assert.ok(await page.getByLabel("Device management").isDisabled());
  assert.ok(await page.getByLabel("Email notifications").isDisabled());
  await page.locator(".account-menu-trigger").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL("**/en-GB/portal");
  assert.equal((await (await context.request.get(base + "/api/auth/me")).json()).user, null);
  assert.deepEqual(errors, []);
  results.push({ browser: name, passed: true, viewports: [1440,768,390,320], languages: ["en-GB","zh-CN"] });
 } catch (error) { results.push({ browser: name, passed: false, error: String(error) }); }
 finally { await browser.close(); }
 console.log(JSON.stringify(results[results.length - 1]));
}
await fs.writeFile(out + "/results.json", JSON.stringify(results, null, 2));
if (results.some((r) => !r.passed)) process.exitCode = 1;

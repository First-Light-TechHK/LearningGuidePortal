import { expect, test } from "playwright/test";

const ENGLISH_METHOD = ["Apply what you learn", "Share your perspective", "See the bigger picture"];

test('zh-CN pricing heading must not be the English "Subscription"', async ({ page }) => {
  const response = await page.goto("/zh-CN/pricing");
  expect(response?.status(), "zh-CN pricing did not render").toBe(200);
  await expect(page.locator(".pricing-design-hero h1"), 'zh-CN pricing visible heading is hardcoded English "Subscription"').not.toHaveText("Subscription");
});

test("zh-CN courses method band must not contain hardcoded English Apply what you learn / Share your perspective / See the bigger picture", async ({ page }) => {
  const response = await page.goto("/zh-CN/portal/courses");
  expect(response?.status(), "zh-CN courses did not render").toBe(200);
  const text = await page.locator(".courses-design-method").innerText();
  for (const phrase of ENGLISH_METHOD) {
    expect(text, `zh-CN courses method band contains hardcoded English "${phrase}"`).not.toContain(phrase);
  }
});

for (const path of ["/en-GB/portal/courses", "/en-GB/pricing"]) {
  test(`at 390px ${path} document scrollWidth must be <= viewport width`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(
      metrics.scrollWidth,
      `${path} scrolls horizontally at 390px (scrollWidth ${metrics.scrollWidth} > viewport ${metrics.viewport})`,
    ).toBeLessThanOrEqual(metrics.viewport + 1);
  });
}

test("at 390px a signed-out header must still expose a way to reach sign-up", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto("/en-GB/pricing");
  expect(response?.status()).toBe(200);
  const signUp = page.locator('header.portal-header a[href*="/sign-up"]');
  const count = await signUp.count();
  let visible = false;
  for (let index = 0; index < count; index += 1) {
    if (await signUp.nth(index).isVisible()) visible = true;
  }
  expect(visible, "signed-out header at 390px hides .portal-header-cta, so there is no visible control that reaches sign-up").toBe(true);
});

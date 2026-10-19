import { expect, test } from "playwright/test";

for (const locale of ["en-GB", "zh-CN"]) {
  test(`password reset request and success preserve the source in ${locale}`, async ({ page }) => {
    const returnTo = `/${locale}/pricing?term=12#plans`;
    await page.route("**/api/auth/password-reset/request", async route => {
      expect(route.request().postDataJSON()).toMatchObject({ email: "reset@example.test", returnTo, locale });
      await route.fulfill({ json: { ok: true, retryAfter: 60, resetUrl: null } });
    });
    await page.goto(`/${locale}/portal/sign-in?step=password&email=reset%40example.test&returnTo=${encodeURIComponent(returnTo)}`);
    await page.waitForLoadState("networkidle");
    await page.locator('.auth-options a').click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator('input[type="email"]')).toHaveValue("reset@example.test");
    await page.locator("form button").click();
    await page.waitForURL("**/portal/password-reset-sent?**");
    await expect(page.locator("form button")).toBeDisabled();
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe(returnTo);
    await page.route("**/api/auth/password-reset/confirm", route => route.fulfill({ json: { ok: true } }));
    await page.goto(`/${locale}/portal/reset-password?token=fake-ui-token&returnTo=${encodeURIComponent(returnTo)}`);
    await page.waitForLoadState("networkidle");
    await page.locator('input[type="password"]').nth(0).fill("New-password-123");
    await page.locator('input[type="password"]').nth(1).fill("Mismatch-password");
    await page.locator("form button").click();
    await expect(page.locator("form [role=alert]")).toBeVisible();
    await page.locator('input[type="password"]').nth(1).fill("New-password-123");
    await page.locator("form button").click();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator("section.portal-form [role=status]")).toBeVisible();
    expect(new URL(page.url()).searchParams.has("token")).toBe(false);
    await page.locator("section.portal-form a").click();
    await page.waitForURL("**/portal/sign-in?**");
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe(returnTo);
  });
}

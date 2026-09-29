import { expect, test } from "playwright/test";

for (const locale of ["en-GB", "zh-CN"]) {
  test(`binding link handles cross-device success and invalid links in ${locale}`, async ({ page }) => {
    const returnTo = `/${locale}/pricing?term=6`;
    await page.route("**/api/auth/email-binding/confirm", async route => {
      expect(route.request().postDataJSON()).toMatchObject({ token: "test-binding", returnTo });
      await route.fulfill({ json: { ok: true, sameUser: false, continueUrl: `/api/auth/wechat?${new URLSearchParams({ locale, returnTo })}` } });
    });
    await page.goto(`/${locale}/portal/bind-email/verify?${new URLSearchParams({ token: "test-binding", returnTo })}`);
    await expect(page.locator("section.portal-form [role=status]")).toBeVisible();
    await expect(page.locator("section.portal-form a")).toHaveAttribute("href", `/api/auth/wechat?${new URLSearchParams({ locale, returnTo })}`);
    expect(new URL(page.url()).searchParams.has("token")).toBe(false);
    await page.unroute("**/api/auth/email-binding/confirm");
    await page.route("**/api/auth/email-binding/confirm", route => route.fulfill({ status: 400, json: { ok: false, code: "invalid_link" } }));
    await page.goto(`/${locale}/portal/bind-email/verify?token=expired&returnTo=${encodeURIComponent(returnTo)}`);
    await expect(page.locator("section.portal-form [role=alert]")).toBeVisible();
    await expect(page.locator("section.portal-form a")).toHaveAttribute("href", `/${locale}/portal/bind-email?returnTo=${encodeURIComponent(returnTo)}`);
    await page.goto(`/${locale}/portal/bind-email?returnTo=${encodeURIComponent(returnTo)}`);
    await page.waitForURL("**/portal/sign-in?**");
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe(returnTo);
  });
}

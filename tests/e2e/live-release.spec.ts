import { expect, test } from "playwright/test";

test.describe("live release e2e", () => {
  test("portal catalogue and public course render in both locales", async ({ page, request }) => {
    const courses = await request.get("/api/portal/courses");
    expect(courses.status()).toBe(200);
    const body = await courses.json();
    const slug = body.courses?.[0]?.slug;
    expect(slug).toBeTruthy();

    for (const locale of ["en-GB", "zh-CN"]) {
      await page.goto(`/${locale}/portal`);
      await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error/i);
      await expect(page.locator(".portal-course-card, .portal-course-grid, a[href*='/portal/courses/']").first()).toBeVisible();
    }

    await page.goto(`/en-GB/portal/courses/${slug}`);
    await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error/i);
  });

  test("sign-in is an email-first form and protected APIs stay closed", async ({ page, request }) => {
    await page.goto("/en-GB/portal/sign-in");
    await expect(page.locator('input[type="email"]')).toBeVisible();
    expect((await request.get("/api/my-learning")).status()).toBe(401);
  });

  test("registration sends mail for a SES-verified tester and hides AWS errors", async ({ request }) => {
    const email = process.env.LIVE_TEST_EMAIL;
    test.skip(!email, "LIVE_TEST_EMAIL is required");
    const response = await request.post("/api/auth/register", {
      data: { email, password: "SitSmoke-Passw0rd!", nickname: "SIT smoke", locale: "en-GB" }
    });
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(/ses:SendEmail|assumed-role|not authorized to perform/i);
    expect(response.status(), JSON.stringify(body)).toBe(200);
    expect(body.ok).toBeTruthy();
    if (body.data?.verificationRequired) {
      expect((await request.post("/api/auth/login", { data: { email, password: "SitSmoke-Passw0rd!" } })).status()).not.toBe(200);
    } else {
      const resend = await request.post("/api/auth/resend-verification", { data: { email, locale: "en-GB" } });
      expect(JSON.stringify(await resend.json())).not.toMatch(/ses:SendEmail|assumed-role|not authorized to perform/i);
      expect(resend.status()).toBe(200);
    }
    const probe = await request.post("/api/auth/register", {
      data: { email: "sit-ses-probe@example.test", password: "SitSmoke-Passw0rd!", nickname: "SES probe", locale: "en-GB" }
    });
    expect(JSON.stringify(await probe.json())).not.toMatch(/ses:SendEmail|assumed-role|not authorized to perform/i);
  });

  test("admin host is isolated from the learner origin", async ({ request }) => {
    expect((await request.get("/en-GB/backoffice", { maxRedirects: 0 })).status()).toBe(404);
    const admin = process.env.LIVE_ADMIN_ORIGIN;
    if (!admin) return;
    const response = await request.get(new URL("/en-GB/backoffice", admin).toString(), { maxRedirects: 0 });
    expect(response.status(), "admin backoffice").not.toBe(404);
  });
});

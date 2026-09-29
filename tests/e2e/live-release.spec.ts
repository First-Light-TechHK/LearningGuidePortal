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
    await expect(page.locator("main, h1").first()).toBeVisible();
    const sources = await page.locator("img[src]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("src")).filter((src): src is string => Boolean(src)));
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.join(" ")).not.toContain("myqcloud.com");
    for (const src of sources.slice(0, 4)) {
      const image = await request.get(src);
      expect(image.status(), src).toBe(200);
      expect(image.headers()["content-type"] || "", src).toContain("image");
    }

    await page.goto(`/en-GB/portal/courses/${slug}/public-lesson`);
    await expect(page.locator("main, h1").first()).toBeVisible();
    await page.goto("/en-GB/pricing");
    await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error/i);
    await page.goto("/en-GB/account/my-learning");
    await expect(page.locator("#my-learning-heading")).toHaveCount(0);

    expect((await request.post("/api/purchase/checkout", { data: { planId: "everything-pc-6" } })).status()).toBe(401);
    expect((await request.post("/api/trial", { data: { planId: "everything-pc-6" } })).status()).toBe(401);
    expect((await request.post("/api/subscription/portal", { data: {} })).status()).toBe(401);
    expect((await request.post("/api/payment/webhook", { data: { id: "evt_smoke_unsigned" } })).status()).toBe(400);
    expect([403, 404]).toContain((await request.get("/api/backoffice/orders")).status());
    expect([403, 404]).toContain((await request.get("/api/backoffice/courses")).status());
    const admin = process.env.LIVE_ADMIN_ORIGIN;
    if (admin) {
      expect((await request.get(new URL("/api/backoffice/orders", admin).toString())).status()).toBe(403);
      expect((await request.get(new URL("/api/backoffice/courses", admin).toString())).status()).toBe(403);
    }
    expect((await request.post("/api/ai-tutor", { data: { courseId: slug, message: "smoke" } })).status()).toBe(401);
    expect((await request.post("/api/study/events", { data: { courseId: slug, lessonId: "public", event: "complete", seconds: 1, clientEventId: "live-playwright" } })).status()).not.toBe(200);
  });

  test("sign-in is an email-first form and protected APIs stay closed", async ({ page, request }) => {
    await page.goto("/en-GB/portal/sign-in");
    await expect(page.locator('input[type="email"]')).toBeVisible();
    expect((await request.get("/api/my-learning")).status()).toBe(401);
  });

  test("registration sends mail for a SES-verified tester and hides AWS errors", async ({ request }) => {
    const email = process.env.LIVE_TEST_EMAIL;
    expect(email, "LIVE_TEST_EMAIL is required").toBeTruthy();
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

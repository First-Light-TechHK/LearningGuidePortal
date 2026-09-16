import { expect, test } from "playwright/test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const PASSWORD = "Passw0rd!123";

test("header sign-in returns to the source page including query and hash", async ({ page }) => {
  const source = "/en-GB/portal/courses?category=science&sort=title#courses";
  await page.route("**/api/auth/check-email", route => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/auth/login", route => route.fulfill({ json: { ok: true } }));
  await page.goto(source);
  const login = page.locator(".portal-header-link").first();
  await expect(login).toHaveAttribute("href", `/en-GB/portal/sign-in?returnTo=${encodeURIComponent(source)}`);
  await login.click();
  await expect(page.locator(".portal-header-link").first()).toHaveAttribute("href", `/en-GB/portal/sign-in?returnTo=${encodeURIComponent(source)}`);
  await page.locator('input[type="email"]').fill("return-test@example.test");
  await page.locator(".auth-entry-form button[type=submit], .auth-entry-form button.portal-button").click();
  await page.waitForURL(url => url.searchParams.get("step") === "password");
  await page.waitForLoadState("networkidle");
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe(source);
  await page.locator("button.auth-submit").click();
  await page.waitForURL(url => url.pathname + url.search + url.hash === source);
});

test("Remember me restores only email after logout and clears on opt-out", async ({ page }) => {
  const email = "remember-test@example.test";
  await page.route("**/api/auth/login", route => route.fulfill({ json: { ok: true } }));
  await page.goto("/en-GB/portal/sign-in?step=password&returnTo=/en-GB/portal");
  await expect(page.locator(".portal-header-link").first()).toHaveAttribute("href", "/en-GB/portal/sign-in?returnTo=%2Fen-GB%2Fportal");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole("checkbox", { name: "Remember me" }).check();
  await page.locator('button[type="submit"], button.auth-submit').click();
  await page.waitForURL("**/en-GB/portal");
  await page.request.post("/api/auth/logout");
  await page.goto("/en-GB/portal/sign-in?step=password");
  await expect(page.locator('input[type="email"]')).toHaveValue(email);
  await expect(page.locator('input[autocomplete="current-password"]')).toHaveValue("");
  await expect(page.getByRole("checkbox", { name: "Remember me" })).toBeChecked();
  await page.getByRole("checkbox", { name: "Remember me" }).uncheck();
  await page.reload();
  await expect(page.locator('input[type="email"]')).toHaveValue("");
  await expect(page.getByRole("checkbox", { name: "Remember me" })).not.toBeChecked();
});

const publicPaths = [
  "/en-GB/portal",
  "/zh-CN/portal",
  "/en-GB/portal/courses",
  "/zh-CN/portal/courses",
  "/en-GB/portal/courses/epicureanism",
  "/en-GB/portal/courses/epicureanism/public-lesson",
];

test.describe("E2E-B1-001", () => {
  test("public pages return 200; unauthenticated study/events does not grant access", async ({ request }) => {
    for (const route of publicPaths) {
      expect((await request.get(route)).status(), route).toBe(200);
    }
    const write = await request.post("/api/study/events", {
      data: {
        courseId: "epicureanism",
        lessonId: "pleasure-and-the-good-life",
        event: "complete",
        seconds: 60,
        clientEventId: `visitor-${Date.now()}`,
      },
    });
    expect(write.status(), "unauthenticated study/events must not open access").not.toBe(200);
  });
});

test.describe("E2E-B1-002", () => {
  test("verification success does not create a session", async () => {
    const originalCwd = process.cwd();
    const originalFlag = process.env.EMAIL_VERIFICATION_REQUIRED;
    const isolatedCwd = await mkdtemp(path.join(tmpdir(), "learning-guide-e2e-002-"));
    process.env.EMAIL_VERIFICATION_REQUIRED = "1";
    process.chdir(isolatedCwd);
    try {
      const store = await import("../../services/productStore");
      const user = await store.registerUser({
        email: `e2e-002-${Date.now()}@example.test`,
        password: PASSWORD,
        nickname: "E2E Learner",
        locale: "en-GB",
      });
      expect(user.status).toBe("pending");
      const token = await store.issueEmailVerificationToken(user.id);
      const activated = await store.verifyEmailToken(token);
      expect(activated.status).toBe("active");
      expect(activated.emailVerifiedAt).toBeTruthy();
      const data = await store.ensureProductData();
      expect(data.sessions.filter((session) => session.userId === user.id)).toEqual([]);
      expect(await store.getUserBySessionToken(undefined)).toBeNull();
    } finally {
      process.chdir(originalCwd);
      if (originalFlag === undefined) delete process.env.EMAIL_VERIFICATION_REQUIRED;
      else process.env.EMAIL_VERIFICATION_REQUIRED = originalFlag;
      await rm(isolatedCwd, { recursive: true, force: true });
    }
  });
});

test.describe("E2E-B1-003", () => {
  test("verify-email succeeds without a session; token replay returns 400", async () => {
    const originalCwd = process.cwd();
    const originalFlag = process.env.EMAIL_VERIFICATION_REQUIRED;
    const isolatedCwd = await mkdtemp(path.join(tmpdir(), "learning-guide-e2e-003-"));
    process.env.EMAIL_VERIFICATION_REQUIRED = "1";
    process.chdir(isolatedCwd);
    try {
      const store = await import("../../services/productStore");
      const { POST: verifyEmail } = await import("../../app/api/auth/verify-email/route");
      const user = await store.registerUser({
        email: `e2e-003-${Date.now()}@example.test`,
        password: PASSWORD,
        nickname: "E2E Learner",
        locale: "en-GB",
      });
      const token = await store.issueEmailVerificationToken(user.id);
      const first = await verifyEmail(new Request("http://127.0.0.1/api/auth/verify-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }));
      expect(first.status).toBe(200);
      expect(first.headers.get("set-cookie") || "").not.toContain("learning_guide_session");
      const data = await store.ensureProductData();
      expect(data.sessions.filter((session) => session.userId === user.id)).toEqual([]);

      const replay = await verifyEmail(new Request("http://127.0.0.1/api/auth/verify-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }));
      expect(replay.status).toBe(400);
      expect((await replay.json()).code).toBe("VERIFICATION_TOKEN_INVALID");
      await expect(store.verifyEmailToken(token)).rejects.toThrow(/invalid or has expired/i);
    } finally {
      process.chdir(originalCwd);
      if (originalFlag === undefined) delete process.env.EMAIL_VERIFICATION_REQUIRED;
      else process.env.EMAIL_VERIFICATION_REQUIRED = originalFlag;
      await rm(isolatedCwd, { recursive: true, force: true });
    }
  });
});

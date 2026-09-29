import { expect, test, type Page } from "playwright/test";

const PASSWORD = "Passw0rd!123";
const OTHER_PASSWORD = "Otherpass1";
const RETURN_TO = "/en-GB/account/my-learning";
const delivery = process.env.AUTH_MAIL_E2E_MODE === "fail" ? "fail" : "discard";

function uniqueEmail(label: string) {
  return `e2e-${label}-${Date.now()}@example.test`;
}

async function dismissCookies(page: Page) {
  const button = page.getByRole("button", { name: "Use essential cookies only" });
  try {
    await button.waitFor({ state: "visible", timeout: 3_000 });
    await button.click();
  } catch {
    // The banner is optional and must not block sign-up.
  }
}

async function openSignUp(page: Page) {
  await page.goto(`/en-GB/portal/sign-up?returnTo=${encodeURIComponent(RETURN_TO)}`);
  await expect(page).toHaveURL(/\/en-GB\/portal\/sign-up/);
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await dismissCookies(page);
}

type CapturedResponse = {
  status: number;
  body: { ok?: boolean; code?: string; data?: { verificationRequired?: boolean; user?: unknown } };
  headers: Array<{ name: string; value: string }>;
};

async function capturePost(page: Page, urlPart: string, action: () => Promise<void>) {
  let captured: CapturedResponse | undefined;
  const pattern = `**${urlPart}`;
  await page.route(pattern, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    captured = { status: response.status(), body: await response.json(), headers: response.headersArray() };
    await route.fulfill({ response });
  });
  try {
    await action();
    await expect.poll(() => captured?.status, { timeout: 15_000 }).toBeDefined();
  } finally {
    await page.unroute(pattern);
  }
  if (!captured) throw new Error(`No POST ${urlPart} response`);
  return captured;
}

async function submitSignUp(page: Page, email: string, password: string) {
  await page.locator('input[autocomplete="nickname"]').fill("Learner");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[autocomplete="new-password"]').fill(password);
  return capturePost(page, "/api/auth/register", () => page.getByRole("button", { name: "Create account" }).click());
}

function sessionCookies(headers: Array<{ name: string; value: string }>) {
  return headers.filter((header) => header.name.toLowerCase() === "set-cookie" && header.value.includes("learning_guide_session="));
}

test.describe("verification mail accepted", () => {
  test("sign-up lands on check-email and a repeat does not enter the app", async ({ page }) => {
    test.skip(delivery !== "discard", "run with AUTH_MAIL_E2E_MODE=discard");
    const email = uniqueEmail("discard");
    await openSignUp(page);

    const created = await submitSignUp(page, email, PASSWORD);
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ ok: true, data: { verificationRequired: true } });
    expect(created.body.data?.user).toBeUndefined();
    expect(sessionCookies(created.headers)).toEqual([]);
    await page.waitForURL(/\/en-GB\/portal\/check-email\/?$/);
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    expect(page.url()).not.toContain("/account/");
    expect(page.url()).not.toContain("/backoffice");

    await openSignUp(page);
    const duplicate = await submitSignUp(page, email, OTHER_PASSWORD);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toMatchObject({ ok: true, data: { verificationRequired: true } });
    expect(duplicate.body.data?.user).toBeUndefined();
    expect(sessionCookies(duplicate.headers)).toEqual([]);
    await page.waitForURL(/\/en-GB\/portal\/check-email\/?$/);
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    expect(page.url()).not.toContain("/account/");
    expect(page.url()).not.toContain("/backoffice");
  });
});

test.describe("verification mail rejected", () => {
  test("sign-up shows the delivery error and sign-in does not open an account", async ({ page }) => {
    test.skip(delivery !== "fail", "run with AUTH_MAIL_E2E_MODE=fail");
    const email = uniqueEmail("fail");
    await openSignUp(page);

    const created = await submitSignUp(page, email, PASSWORD);
    expect(created.status).toBe(503);
    expect(created.body).toMatchObject({ ok: false, code: "EMAIL_DELIVERY_FAILED" });
    expect(sessionCookies(created.headers)).toEqual([]);
    await expect(page.locator("form [role=alert]")).toContainText("Email delivery failed.");
    await expect(page).toHaveURL(/\/en-GB\/portal\/sign-up/);
    expect(page.url()).not.toContain("check-email");
    expect(page.url()).not.toContain("/account/");
    expect(page.url()).not.toContain("/backoffice");

    await page.goto(`/en-GB/portal/sign-in?step=password&email=${encodeURIComponent(email)}&returnTo=${encodeURIComponent(RETURN_TO)}`);
    await expect(page).toHaveURL(/\/en-GB\/portal\/sign-in/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await dismissCookies(page);
    await expect(page.locator('input[type="email"]')).toHaveValue(email);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    const signedIn = await capturePost(page, "/api/auth/login", () => page.getByRole("button", { name: "Sign in", exact: true }).click());
    expect(signedIn.status).toBe(401);
    expect(signedIn.body).toMatchObject({ ok: false, code: "AUTHENTICATION_FAILED" });
    expect(sessionCookies(signedIn.headers)).toEqual([]);
    await expect(page.locator("form [role=alert]")).toContainText("Email or password is incorrect.");
    await expect(page).toHaveURL(/\/en-GB\/portal\/sign-in/);
    expect(page.url()).not.toContain("/account/");
    expect(page.url()).not.toContain("check-email");
    expect(page.url()).not.toContain("/backoffice");
  });
});

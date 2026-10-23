import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "playwright/test";

// BackOffice Portal PRD v1.1: shell, menu-level RBAC, language, Change Password.
// Runs against the local dev server, where 127.0.0.1 is an admin host (APP_ENV=DEV).
const PASSWORD = "Passw0rd!123";
const stamp = Date.now();
const emails = {
  admin: `bo-admin-${stamp}@example.test`,
  opsAdmin: `bo-ops-${stamp}@example.test`,
  finance: `bo-finance-${stamp}@example.test`,
  password: `bo-pass-${stamp}@example.test`
};

function seedOperator(email: string, role: "admin" | "operation_admin" | "finance") {
  execFileSync(process.execPath, ["--import", "tsx", "--require", "./scripts/register-tsconfig-paths.cjs", "tests/e2e/helpers/seed-backoffice-operator.ts", email, PASSWORD, role], { stdio: "inherit" });
}

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/en-GB/backoffice/sign-in");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.locator("form button.auth-submit").click();
}

const sidebar = (page: Page) => page.locator("aside nav a");

test.beforeAll(() => {
  seedOperator(emails.admin, "admin");
  seedOperator(emails.opsAdmin, "operation_admin");
  seedOperator(emails.finance, "finance");
  seedOperator(emails.password, "admin");
});

test("Admin lands on Course and sees all eight menus in PRD order", async ({ page }) => {
  await signIn(page, emails.admin);
  await page.waitForURL("**/en-GB/backoffice/courses");
  await expect(sidebar(page)).toHaveText(["Course", "Knowledge", "AI Tutor", "Order", "Reporting", "Student", "HelpDesk", "Settings"]);
  await expect(page.locator('aside nav a[aria-current="page"]')).toHaveText("Course");
  await expect(page.getByRole("button", { name: "Account menu" })).toContainText(`bo-admin-${stamp}`);
  await expect(page.getByRole("button", { name: "Account menu" })).toContainText("Admin");

  await page.locator('aside nav a[data-menu="settings"]').click();
  await page.waitForURL("**/en-GB/backoffice/settings/employees");
  await expect(page.locator("[data-settings]")).toHaveText(["Employee Account", "Payment Gateway", "Notification Configuration", "Portal Content"]);
  await expect(page.locator('aside nav a[aria-current="page"]')).toHaveText("Settings");

  for (const [menu, path] of [["reporting", "reporting"], ["student", "students"], ["helpdesk", "helpdesk"], ["order", "orders"]] as const) {
    await page.locator(`aside nav a[data-menu="${menu}"]`).click();
    await page.waitForURL(`**/en-GB/backoffice/${path}`);
    await expect(page.locator(`aside nav a[data-menu="${menu}"]`)).toHaveAttribute("aria-current", "page");
  }

  await page.locator('aside nav a[data-menu="aiTutor"]').click();
  await page.waitForURL("**/knowledge/philosophy/epicureanism/chat-testing");
  await expect(page.locator('aside nav a[data-menu="aiTutor"]')).toHaveAttribute("aria-current", "page");
});

test("sidebar collapses to icons with tooltips and remembers it", async ({ page }) => {
  await signIn(page, emails.admin);
  await page.waitForURL("**/backoffice/courses");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.locator("aside nav a span[class*=label]")).toHaveCount(0);
  await expect(page.locator('aside nav a[data-menu="order"]')).toHaveAttribute("title", "Order");
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(sidebar(page).first()).toHaveText("Course");
});

test("language switch keeps the page and is kept across sign-ins", async ({ page }) => {
  await signIn(page, emails.finance);
  await page.waitForURL("**/en-GB/backoffice/courses");
  await page.locator('aside nav a[data-menu="order"]').click();
  await page.waitForURL("**/en-GB/backoffice/orders");
  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("menuitemradio", { name: "简体中文" }).click();
  await page.waitForURL("**/zh-CN/backoffice/orders");
  await expect(sidebar(page)).toHaveText(["课程", "知识库", "AI 导师", "订单", "报表", "学员", "客服中心", "设置"]);
  await expect(page.getByRole("button", { name: "账号菜单" })).toContainText("财务");

  await page.getByRole("button", { name: "账号菜单" }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await page.waitForURL("**/zh-CN/backoffice/sign-in");
  await signIn(page, emails.finance);
  await page.waitForURL("**/zh-CN/backoffice/courses");
});

test("Operation Admin cannot see or reach Knowledge, AI Tutor or Employee Account", async ({ page }) => {
  await signIn(page, emails.opsAdmin);
  await page.waitForURL("**/en-GB/backoffice/courses");
  await expect(sidebar(page)).toHaveText(["Course", "Order", "Reporting", "Student", "HelpDesk", "Settings"]);
  await page.locator('aside nav a[data-menu="settings"]').click();
  await page.waitForURL("**/en-GB/backoffice/payment");
  await expect(page.locator("[data-settings]")).toHaveText(["Payment Gateway", "Notification Configuration", "Portal Content"]);

  for (const path of ["/en-GB/backoffice/knowledge", "/en-GB/backoffice/ai-tutor", "/knowledge/philosophy/epicureanism/knowledge-wiki", "/knowledge/philosophy/epicureanism/chat-testing", "/en-GB/backoffice/settings/employees"]) {
    expect((await page.request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
  }
  for (const path of ["/api/wiki/tree", "/api/chat-testing", "/api/releases"]) {
    expect((await page.request.get(path)).status(), path).toBe(404);
  }
  // Menus the role has stay open, page and API alike.
  expect((await page.request.get("/en-GB/backoffice/reporting")).status()).toBe(200);
  expect((await page.request.get("/api/backoffice/orders")).status()).toBe(200);
});

test("Change Password checks the current password and ends the session", async ({ page }) => {
  await signIn(page, emails.password);
  await page.waitForURL("**/backoffice/courses");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Change Password" }).click();
  const dialog = page.getByRole("dialog", { name: "Change Password" });
  await dialog.getByLabel("Current password").fill("wrong-password");
  await dialog.getByLabel("New password", { exact: true }).fill("N3wPassw0rd!");
  await dialog.getByLabel("Confirm new password").fill("N3wPassw0rd!");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Current password is incorrect.");
  await dialog.getByLabel("Current password").fill(PASSWORD);
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.waitForURL("**/en-GB/backoffice/sign-in");
  expect((await page.request.get("/api/backoffice/orders")).status()).toBe(403);
  await signIn(page, emails.password);
  await expect(page.locator('[role="alert"]')).toBeVisible();
  await signIn(page, emails.password, "N3wPassw0rd!");
  await page.waitForURL("**/en-GB/backoffice/courses");
});

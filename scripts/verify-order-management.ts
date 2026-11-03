import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { chromium, expect } from "playwright/test";
import { getMessages } from "../lib/i18n/messages";

// Production Next pages and real Session/API boundaries, with disposable local demo payments only.
async function main() {
  const repo = process.cwd(), environment = { ...process.env }, dist = process.env.NEXT_DIST_DIR || ".next-order-check";
  await readFile(path.join(repo, dist, "BUILD_ID"));
  const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as { port: number }).port, origin = `http://127.0.0.1:${port}`;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const temporary = await mkdtemp(path.join(tmpdir(), "lg-order-management-"));
  const output = path.join(repo, "test-results/order-management-production"); await mkdir(output, { recursive: true });
  Object.assign(process.env, { STORAGE_BACKEND: "local", APP_ENV: "DEV", PAYMENT_MODE: "demo", LOCAL_EMAIL_PREVIEW: "1", LOCAL_SOCIAL_LOGIN: "0",
    NEXT_DIST_DIR: dist, NEXT_PUBLIC_APP_URL: origin, SESSION_SECRET: "order-management-disposable-local-secret", STRIPE_SECRET_KEY: "" });
  process.chdir(temporary);
  let server: ReturnType<typeof spawn> | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const store = await import("../services/productStore");
    const buyers: Array<{ locale: "en-GB" | "zh-CN"; owner: { id: string }; pending: { order: { id: string } }; missing: { order: { id: string } }; session: { token: string } }> = [];
    for (const locale of ["en-GB", "zh-CN"] as const) {
      const owner = await store.registerUser({ email: `orders-${locale}@example.test`, password: "Local-orders-only1", nickname: "Order Learner", locale });
      await store.verifyEmailToken(await store.issueEmailVerificationToken(owner.id));
      const source = await store.createQuote(owner.id, "epicureanism-pc-6"); await store.completeDemoCheckout(owner.id, source.quote.id);
      const quote = await store.createQuote(owner.id, "science-pc-6"), pending = await store.createPendingDemoOrder(owner.id, quote.quote.id);
      const otherQuote = await store.createQuote(owner.id, "chinese-humanities-pc-6"), missing = await store.createPendingDemoOrder(owner.id, otherQuote.quote.id);
      buyers.push({ locale, owner, pending, missing, session: await store.createSession(owner.id) });
    }
    const file = path.join(temporary, "data/knowledge_system/learning_guide/product.json"), data = JSON.parse(await readFile(file, "utf8"));
    for (const buyer of buyers) data.orders.find((order: { id: string }) => order.id === buyer.missing.order.id).paymentMode = "stripe";
    await writeFile(file, JSON.stringify(data));
    server = spawn(process.execPath, [path.join(repo, "node_modules/next/dist/bin/next"), "start", repo, "-p", String(port), "--hostname", "127.0.0.1"], { cwd: temporary, env: process.env, windowsHide: true, stdio: "ignore" });
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { if ((await fetch(`${origin}/en-GB/portal/sign-in`, { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch { /* Isolated startup. */ }
      if (server.exitCode !== null) throw new Error("Isolated Next server stopped.");
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready); browser = await chromium.launch();
    for (const buyer of buyers) {
      const { locale, pending, missing } = buyer, text = getMessages(locale).orderManagement;
      const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
      const pathToOrders = `/${locale}/account/my-learning/subscription`;
      assert.equal((await context.request.get(`${origin}/api/my-learning/orders`)).status(), 401);
      await context.addCookies([{ name: "learning_guide_session", value: buyer.session.token, url: origin }]);
      const foreignId = buyers.find(item => item.owner.id !== buyer.owner.id)!.pending.order.id;
      const foreign = await context.request.post(`${origin}/api/my-learning/orders/${foreignId}`, { headers: { origin }, data: { action: "cancel" } });
      assert.equal(foreign.status(), 404);
      const evil = await context.request.post(`${origin}/api/my-learning/orders/${pending.order.id}`, { headers: { origin: "https://evil.example" }, data: { action: "cancel" } });
      assert.equal(evil.status(), 403);
      const page = await context.newPage(), errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${origin}${pathToOrders}?orderId=${pending.order.id}`);
      await page.getByRole("button", { name: getMessages(locale).legal.rejectOptional, exact: true }).click();
      const row = page.locator(`[data-order-id="${pending.order.id}"]`), missingRow = page.locator(`[data-order-id="${missing.order.id}"]`);
      await expect(row.getByRole("button", { name: text.resume, exact: true })).toBeEnabled();
      await expect(missingRow.getByText(text.reasons.missing_payment)).toBeVisible();
      assert.equal(await page.locator(`[data-order-id="${foreignId}"]`).count(), 0);
      await expect(page.locator('[data-subscription-id]')).toHaveCount(1);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1100 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: path.join(output, `${locale}-${width}-pending.png`), fullPage: true });
      }
      await row.getByRole("button", { name: text.resume, exact: true }).click();
      await page.waitForURL(url => url.pathname === `/${locale}/portal/payment/checkout` && url.searchParams.get("orderId") === pending.order.id);
      await page.goto(`${origin}${pathToOrders}`);
      await expect(row.getByRole("button", { name: text.cancel, exact: true })).toBeEnabled();
      await row.getByRole("button", { name: text.cancel, exact: true }).click();
      const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
      await page.screenshot({ path: path.join(output, `${locale}-cancel-dialog.png`), fullPage: true });
      await dialog.getByRole("button", { name: text.confirmCancel, exact: true }).click(); await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("heading", { name: `${text.title} (1)`, exact: true })).toBeVisible();
      await page.getByText(`${text.history} (1)`, { exact: true }).click();
      await expect(row.getByText(text.states.canceled, { exact: true })).toBeVisible();
      await expect(page.locator('[data-subscription-id]')).toHaveCount(1);
      const listed = await context.request.get(`${origin}/api/my-learning/orders`);
      assert.match(listed.headers()["cache-control"], /no-store/);
      const records = (await listed.json()).data.orders;
      assert.equal(records.find((order: { id: string }) => order.id === pending.order.id).status, "canceled");
      assert.equal(records.find((order: { id: string }) => order.id === missing.order.id).status, "pending");
      assert.deepEqual(errors, []); await context.close();
    }
    console.log("PASS: production bilingual pending-order pages, real Session/API ownership, same-origin actions, demo resume/cancel, retained subscription and missing-reference recovery.");
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) { const stopped = new Promise<void>(resolve => server!.once("exit", () => resolve())); server.kill(); await stopped; }
    process.chdir(repo); process.env = environment;
    const resolved = path.resolve(temporary);
    if (path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith("lg-order-management-")) await rm(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

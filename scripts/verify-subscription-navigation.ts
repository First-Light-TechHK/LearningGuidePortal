import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { getMessages } from "../lib/i18n/messages";

// Requires a production build. Uses a separate local store and never charges Stripe.
async function main() {
  const repo = process.cwd(), previousEnv = { ...process.env };
  const dist = process.env.NEXT_DIST_DIR || ".next-ui-check";
  await readFile(path.join(repo, dist, "BUILD_ID"));
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as { port: number }).port, origin = `http://127.0.0.1:${port}`;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const temporary = await mkdtemp(path.join(tmpdir(), "lg-subscription-navigation-"));
  const output = path.join(repo, "test-results/subscription-navigation");
  await mkdir(output, { recursive: true });
  Object.assign(process.env, { STORAGE_BACKEND: "local", APP_ENV: "DEV", PAYMENT_MODE: "demo", LOCAL_EMAIL_PREVIEW: "1", LOCAL_SOCIAL_LOGIN: "0", NEXT_DIST_DIR: dist, NEXT_PUBLIC_APP_URL: origin, SESSION_SECRET: "subscription-navigation-disposable-test-secret" });
  process.chdir(temporary);
  let server: ReturnType<typeof spawn> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const store = await import("../services/productStore");
    const sessions = new Map<string, string>();
    for (const [kind, planIds] of Object.entries({ none: [], one_category: ["science-pc-6"], two_categories: ["science-pc-6", "chinese-humanities-pc-6"], all_categories: ["science-pc-6", "chinese-humanities-pc-6", "european-humanities-pc-6"], everything: ["everything-pc-6"] })) {
      const user = await store.registerUser({ email: `${kind}@navigation.example.test`, password: "Local-only-password1", nickname: "Learner" });
      await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
      for (const planId of planIds) {
        const { quote } = await store.createQuote(user.id, planId);
        await store.completeDemoCheckout(user.id, quote.id);
      }
      assert.equal((await store.getSubscriptionSelection(user.id)).kind, kind);
      sessions.set(kind, (await store.createSession(user.id)).token);
    }
    server = spawn(process.execPath, [path.join(repo, "node_modules/next/dist/bin/next"), "start", repo, "-p", String(port), "--hostname", "127.0.0.1"], { cwd: temporary, env: process.env, windowsHide: true, stdio: "ignore" });
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { if ((await fetch(`${origin}/en-GB/portal`, { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch { /* Wait for the isolated server. */ }
      if (server.exitCode !== null) throw new Error("Isolated Next server stopped");
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, "isolated production server starts");
    browser = await chromium.launch({ channel: "msedge" });
    for (const locale of ["en-GB", "zh-CN"] as const) {
      const context = await browser.newContext(), page = await context.newPage();
      const label = getMessages(locale).portal.navigation.pricing;
      const selectIdentity = async (kind: string | null) => {
        await context.clearCookies();
        if (kind) await context.addCookies([{ name: "learning_guide_session", value: sessions.get(kind)!, url: origin }]);
      };
      // Warm the client router with the anonymous page, then change Session externally.
      // Header's /auth/me reconciliation cannot refresh a cached Subscription body.
      await page.goto(`${origin}/${locale}/subscription`);
      assert.equal(await page.locator(".pricing-owned-notice,.pricing-owned-status").count(), 0);
      for (const kind of ["one_category", "two_categories", "all_categories", "everything", "none"]) {
        await Promise.all([page.waitForURL(`${origin}/${locale}/portal`), page.locator("header .portal-brand").click()]);
        await page.waitForLoadState("networkidle");
        await selectIdentity(kind);
        const responsePromise = page.waitForResponse(response => response.request().isNavigationRequest() && response.request().resourceType() === "document" && new URL(response.url()).pathname === `/${locale}/subscription`, { timeout: 10000 });
        await page.locator("header nav").getByRole("link", { name: label, exact: true }).click();
        const response = await responsePromise;
        assert.equal(response.status(), 200);
        const serverHtml = await response.text();
        assert.ok(!serverHtml.includes(`<p role="status">${getMessages(locale).subscriptionSelection.loading}</p>`), "Subscription must not stream a standalone loading page");
        if (kind === "none") {
          assert.equal(await page.locator(".pricing-owned-notice,.pricing-owned-status").count(), 0);
          await page.getByRole("heading", { name: getMessages(locale).pricingDesign.heading, exact: true }).waitFor();
        } else {
          await page.locator(`[data-subscription-state="${kind}"]`).waitFor();
          assert.ok(serverHtml.includes(`data-subscription-state="${kind}"`), "the first server response already has the current user's state");
        }
        await page.screenshot({ path: path.join(output, `${locale}-${kind}.png`), fullPage: true });
        // Same-page navigation must recheck too, including account changes and sign-out.
        await selectIdentity(null);
        const signedOut = page.waitForResponse(response => response.request().isNavigationRequest() && response.request().resourceType() === "document" && new URL(response.url()).pathname === `/${locale}/subscription`);
        await page.locator("header nav").getByRole("link", { name: label, exact: true }).click();
        await signedOut;
        await page.getByRole("heading", { name: getMessages(locale).pricingDesign.heading, exact: true }).waitFor();
        assert.equal(await page.locator(".pricing-owned-notice,.pricing-owned-status").count(), 0);
      }
      await selectIdentity("everything");
      await page.goto(`${origin}/${locale}/portal/study-groups`);
      const studyNavigation = page.waitForResponse(response => response.request().isNavigationRequest() && response.request().resourceType() === "document" && new URL(response.url()).pathname === `/${locale}/subscription`);
      await page.locator("header nav").getByRole("link", { name: label, exact: true }).click();
      await studyNavigation;
      await page.locator('[data-subscription-state="everything"]').waitFor();
      // Slow an actual client-side AccountNav request: keep the current Settings
      // page usable until My Subscription is ready, with no blank/loading route.
      await page.goto(`${origin}/${locale}/account/my-learning/settings`);
      const settings = page.locator('.settings-design-form');
      await settings.waitFor();
      assert.equal(await page.locator('#settings-device-heading,#settings-email-heading').count(), 0);
      let release: (() => void) | undefined;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const target = `${origin}/${locale}/account/my-learning/subscription`;
      await page.route(`${target}*`, async route => { await gate; await route.continue(); });
      try {
        const started = page.waitForRequest(request => new URL(request.url()).pathname === `/${locale}/account/my-learning/subscription`);
        await page.locator('.account-nav').getByRole('link', { name: getMessages(locale).account.subscription, exact: true }).click();
        await started;
        await page.waitForTimeout(500);
        assert.equal(await settings.isVisible(), true, 'Settings stays visible during a slow transition');
        assert.equal(await page.getByRole('status').filter({hasText:/Loading|加载/}).count(), 0);
        await page.screenshot({ path: path.join(output, `${locale}-pending-account-navigation.png`), fullPage: true });
      } finally { release?.(); }
      await page.waitForURL(target);
      await page.getByRole('heading', { name: getMessages(locale).account.subscription, exact: true }).waitFor();
      assert.equal(await settings.count(), 0);
      assert.equal(await page.getByRole('status').filter({hasText:/Loading|加载/}).count(), 0);
      await page.unroute(`${target}*`);
      await page.screenshot({ path: path.join(output, `${locale}-account-navigation-ready.png`), fullPage: true });
      await context.close();
    }
    console.log("PASS: first Subscription document response selects all five current-user states; both locales retain Settings during delayed account navigation, omit disabled settings and show no standalone loading page.");
  } finally {
    await browser?.close();
    if (server) {
      const exited = new Promise<void>(resolve => server!.once("exit", () => resolve()));
      if (server.exitCode === null) { server.kill(); await exited; }
    }
    process.chdir(repo); process.env = previousEnv;
    if (path.dirname(temporary) === tmpdir() && path.basename(temporary).startsWith("lg-subscription-navigation-")) await rm(temporary, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

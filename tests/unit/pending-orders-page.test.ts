import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, expect } from "playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { getMessages } from "../../lib/i18n/messages";
import type { ManagedOrder } from "../../contracts/order-management";

test("pending orders expose independent payments, safe actions, cancellation retry and bilingual mobile states", { timeout: 120_000 }, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {PendingOrders} from './components/portal/PendingOrders';
    const root=createRoot(document.getElementById('root'));window.mount=props=>root.render(<React.StrictMode><PendingOrders key={props.key} {...props}/></React.StrictMode>);
  ` }, bundle: true, write: false, outfile: "orders.js", platform: "browser", jsx: "automatic", loader: { ".css": "local-css" },
    plugins: [{ name: "next", setup(builder) {
      builder.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("navigation")
        ? "const router={refresh(){window.refreshes=(window.refreshes||0)+1}};export const useRouter=()=>router;"
        : "import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>}", loader: "tsx", resolveDir: process.cwd() }));
    } }] });
  const browser = await chromium.launch();
  await mkdir("test-results/pending-orders", { recursive: true });
  const fixture = (id: string, state: ManagedOrder["state"]): ManagedOrder => ({ id, name: "Science", kind: "purchase", status: state === "canceled" ? "canceled" : "pending", state,
    amountMinor: 3900, currency: "usd", termMonths: 6, createdAt: "2026-11-02T08:00:00Z", expiresAt: state === "awaiting_payment" ? "2030-11-03T10:00:00Z" : null,
    checkedAt: null, reason: state === "unavailable" ? "provider_unavailable" : null, canResume: state === "awaiting_payment", canCancel: state === "awaiting_payment" });
  try {
    for (const locale of ["en-GB", "zh-CN"] as const) {
      const text = getMessages(locale).orderManagement;
      const rows = [fixture("orphan", "awaiting_payment"), fixture("processing", "processing"), { ...fixture("upgrade", "synchronising"), kind: "upgrade" as const }, fixture("unknown", "unavailable"), fixture("closed", "canceled")];
      const calls: Array<{ id: string; action: string }> = [];
      let rejectCancel = true, rejectList = false;
      const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
      page.setDefaultTimeout(6000);
      await page.route("http://orders.test/**", async route => {
        const url = new URL(route.request().url());
        if (url.pathname === "/api/my-learning/orders") return route.fulfill({ status: rejectList ? 503 : 200, json: rejectList ? { message: text.errors.payment_unavailable } : { ok: true, data: { orders: rows } } });
        if (url.pathname.startsWith("/api/my-learning/orders/")) {
          const id = url.pathname.split("/").at(-1)!, { action } = route.request().postDataJSON();
          calls.push({ id, action });
          const row = rows.find(row => row.id === id)!;
          if (action === "cancel" && rejectCancel) return route.fulfill({ status: 503, json: { message: text.errors.payment_unavailable } });
          if (action === "cancel") Object.assign(row, { status: "canceled", state: "canceled", canCancel: false, canResume: false });
          if (action === "check" && id === "unknown" && !rejectCancel) Object.assign(row, { state: "awaiting_payment", reason: null, canCancel: true, canResume: true });
          return route.fulfill({ json: { ok: true, data: { order: row, ...(action === "resume" ? { checkoutUrl: "https://checkout.stripe.com/c/pay/original" } : {}) } } });
        }
        return route.fulfill({ contentType: "text/html", body: '<main style="max-width:900px;margin:auto;padding:24px"><div id="root"></div></main>' });
      });
      await page.goto(`http://orders.test/${locale}/account/my-learning/subscription`);
      await page.addStyleTag({ content: await readFile("app/styles.css", "utf8") });
      await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith("css"))!.text });
      await page.addScriptTag({ content: "window.__name=value=>value" });
      await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith("js"))!.text });
      const mount = async (key: string, initialOrders: ManagedOrder[]) => page.evaluate(props => (window as any).mount(props), { key, locale, initialOrders });
      await mount("orders", structuredClone(rows));
      const card = (id: string) => page.locator(`[data-order-id="${id}"]`);
      await expect(card("orphan").getByRole("button", { name: text.resume, exact: true })).toBeEnabled();
      await expect.poll(() => calls.filter(call => call.action === "check").length).toBe(4);
      await expect(card("orphan").getByRole("button", { name: text.resume, exact: true })).toBeEnabled();
      assert.equal(await card("processing").getByRole("button", { name: text.cancel, exact: true }).count(), 0);
      assert.equal(await card("upgrade").getByRole("button", { name: text.resume, exact: true }).count(), 0);
      await expect(card("unknown").getByText(text.reasons.provider_unavailable)).toBeVisible();
      await expect(card("orphan").getByRole("link", { name: text.support })).toHaveAttribute("href", `/${locale}/account/my-learning/support?orderId=orphan`);
      for (const width of [1100, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: `test-results/pending-orders/${locale}-${width}.png`, fullPage: true });
      }
      await card("orphan").getByRole("button", { name: text.cancel, exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible(); await expect(dialog.getByText(text.cancelDescription)).toBeVisible();
      const confirm = dialog.getByRole("button", { name: text.confirmCancel, exact: true });
      await confirm.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
      await expect(dialog.getByRole("alert")).toHaveText(text.errors.payment_unavailable);
      assert.equal(calls.filter(call => call.action === "cancel").length, 1);
      rejectCancel = false; await confirm.click(); await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("heading", { name: `${text.title} (3)`, exact: true })).toBeVisible();
      await page.getByText(`${text.history} (2)`, { exact: true }).click();
      await expect(card("orphan").getByText(text.states.canceled, { exact: true })).toBeVisible();
      assert.equal(await card("orphan").getByRole("button").count(), 0);
      await card("unknown").getByRole("button", { name: text.check, exact: true }).click();
      await expect(card("unknown").getByRole("button", { name: text.resume, exact: true })).toBeEnabled();
      rejectList = true; await page.getByRole("button", { name: text.refresh, exact: true }).click();
      await expect(page.getByRole("alert")).toHaveText(text.errors.payment_unavailable);
      rejectList = false; await page.getByRole("button", { name: text.refresh, exact: true }).click();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await mount("empty", []); await expect(page.getByText(text.empty)).toBeVisible();
      await mount("resume", [fixture("unknown", "awaiting_payment")]);
      await expect(card("unknown").getByRole("button", { name: text.resume, exact: true })).toBeEnabled();
      const navigation = page.waitForRequest("https://checkout.stripe.com/c/pay/original");
      await page.route("https://checkout.stripe.com/**", route => route.fulfill({ contentType: "text/html", body: "<p>Fixture payment</p>" }));
      await card("unknown").getByRole("button", { name: text.resume, exact: true }).click(); await navigation;
      await expect(page).toHaveURL("https://checkout.stripe.com/c/pay/original");
      await page.close();
    }
  } finally { await browser.close(); }
});

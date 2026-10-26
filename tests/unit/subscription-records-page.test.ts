import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultPortalContent } from "../../lib/portalContent";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getMessages } from "../../lib/i18n/messages";

test("Subscription products start collapsed, expand independently, preserve billing errors and work in both locales", async () => {
  const bundle = await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {PortalHeader} from './components/portal/PortalHeader';import {SubscriptionManager} from './components/portal/SubscriptionManager';import {AccountNav} from './components/portal/AccountNav';import {getMessages} from './lib/i18n/messages';import styles from './components/portal/subscription-records.module.css';const root=createRoot(document.getElementById('root'));window.mount=props=>root.render(<main className="portal-page portal-account-page subscription-design-page"><PortalHeader locale={props.locale} signedIn active="my-learning" displayName="M"/><AccountNav locale={props.locale} copy={getMessages(props.locale).account}/><section className="portal-section portal-section-first"><h1>{getMessages(props.locale).account.subscription}</h1><p className="subscription-page-intro">{getMessages(props.locale).subscriptionDesign.intro}</p><SubscriptionManager key={props.key} {...props} copy={getMessages(props.locale).learning}/></section><footer className="portal-footer" dangerouslySetInnerHTML={{__html:props.footer}}/></main>);`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, outfile: "subscription.js", platform: "browser", external: ["/portal/*"], jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "next", setup(builder) {
      builder.onResolve({ filter: /^next\/(image|link|navigation)$/ }, args => ({ path: args.path, namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ resolveDir: process.cwd(), contents: args.path === "next/navigation" ? `export function usePathname(){return location.pathname};export const useSearchParams=()=>new URLSearchParams(location.search);` : args.path === "next/link" ? `import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/ >}` : `import React from 'react';export default function Image({unoptimized,...props}){return <img {...props}/ >}`, loader: "tsx" }));
    } }],
  });
  const browser = await chromium.launch();
  const output = "test-results/subscription-records"; await mkdir(output, { recursive: true });
  (globalThis as any).subscriptionFooter = defaultPortalContent;
  const footerBundle = await build({ entryPoints: ["components/portal/PortalFooter.tsx"], bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", external: ["react", "react/jsx-runtime"], plugins: [{ name: "footer", setup(b) {
    b.onResolve({ filter: /^next\/|services\/productStore$/ }, args => ({ path: args.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path.endsWith("productStore") ? "export async function getPortalContent(){return globalThis.subscriptionFooter}" : "import React from 'react';export default function Component({prefetch,...p}){return p.src?<img {...p}/>:<a {...p}/>}" }));
  } }] });
  const filename = path.resolve(output, "footer.cjs"); await writeFile(filename, footerBundle.outputFiles[0].text);
  const Footer = createRequire(import.meta.url)(filename).PortalFooter;
  const make = (id: string, name: string, state = "active", validTo = "2026-11-15") => ({ id, scope: name === "Everything" ? "everything" : "category", scopeId: name, device: "pc", source: "purchase", state, validFrom: "2026-05-16", validTo, graceEndsAt: state === "grace" ? "2026-10-18" : undefined, stripeSubscriptionId: "stripe-" + id, stripeCustomerId: "customer", plan: { id: "plan-" + id, name, scope: name === "Everything" ? "everything" : "category", scopeId: name } });
  const chinese = make("chinese", "Chinese Humanities", "grace"), science = make("science", "Science"), european = make("european", "European Humanities", "cancel_at_period_end", "2026-10-31"), expired = make("expired", "Everything", "expired", "2026-06-30");
  const order = (sub: ReturnType<typeof make>, id: string, status = "paid", createdAt = "2026-05-17") => ({ id, stripeSubscriptionId: sub.stripeSubscriptionId, status, amountMinor: 3900, currency: "usd", paymentMode: "stripe", stripeInvoiceId: status === "paid" ? "invoice-" + id : null, createdAt, servicePeriodStart: status === "paid" ? "2026-05-16" : null, servicePeriodEnd: status === "paid" ? sub.validTo : null, plan: sub.plan });
  const currentOrders = [order(science, "science-paid"), order(science, "science-failed", "failed", "2026-05-16"), { ...order(science, "science-old", "paid", "2025-11-16"), servicePeriodStart: "2025-11-16", servicePeriodEnd: "2026-05-15" }, order(chinese, "chinese-paid"), order(european, "european-paid"), order(expired, "expired-paid")];
  try { for (const locale of ["en-GB", "zh-CN"] as const) {
    const copy = getMessages(locale), page = await browser.newPage({ viewport: { width: 1440, height: 1563 } });
    await page.clock.setFixedTime(new Date("2026-10-13T00:00:00Z"));
    const requests: any[] = []; let reject = true;
    await page.route("http://subscription.test/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/api/subscription") {
        requests.push(route.request().postDataJSON());
        const body = route.request().postDataJSON();
        return route.fulfill({ status: reject ? 503 : 200, json: reject ? { code: "provider_unavailable" } : { subscription: { ...science, state: body.action === "resume" ? "active" : "cancel_at_period_end" } } });
      }
      if (pathname === "/api/subscription/portal") return route.fulfill({ status: 503, json: { error: "Fixture billing failure" } });
      if (pathname.startsWith("/portal/")) return route.fulfill({ body: await readFile(path.join("public", pathname)), contentType: pathname.endsWith("svg") ? "image/svg+xml" : "image/png" });
      return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    });
    await page.goto(`http://subscription.test/${locale}/account/my-learning/subscription`);
    for (const file of ["app/styles.css", "app/portal-design.css"]) await page.addStyleTag({ content: await readFile(file, "utf8") });
    await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith("css"))!.text });
    for (const weight of [400, 500, 600, 700]) await page.addStyleTag({ content: `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${(await readFile(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`)).toString("base64")});font-weight:${weight}}` });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith("js"))!.text });
    const footer = renderToStaticMarkup(await Footer({ locale })).replace(/^<footer[^>]*>/, "").replace(/<\/footer>$/, "");
    const mount = (key: string, subscriptions: any[], orders: any[]) => page.evaluate(props => (window as any).mount(props), { key, locale, footer, initialSubscriptions: subscriptions, initialOrders: orders });
    const card = (id: string) => page.locator(`[data-subscription-id="${id}"]`);
    await mount("categories", [chinese, science, european, expired], currentOrders);
    await card("science").waitFor();
    await page.locator(".account-menu-trigger").click();
    assert.equal(await page.locator(".account-menu-identity strong").innerText(), "M");
    assert.equal(await page.locator(".account-menu-identity div span").count(), 0);
    assert.equal(await page.getByRole("menuitem").first().innerText(), locale === "zh-CN" ? "我的学习" : "My Learning");
    await page.keyboard.press("Escape");
    assert.equal(await page.getByText(copy.subscriptionDesign.points, { exact: true }).count(), 0);
    assert.equal(await page.getByRole("table").count(), 0);
    await card("science").getByRole("button", { name: copy.subscriptionDesign.paymentHistory }).click();
    assert.deepEqual(await page.getByRole("columnheader").allTextContents(), [copy.subscriptionDesign.paymentDate, copy.learning.amount, copy.subscriptionDesign.status, copy.learning.validPeriod, copy.learning.receipt]);
    assert.equal(await card("science").locator('td[data-status="paid"]').count(), 2);
    assert.equal(await card("science").locator('td[data-status="failed"]').count(), 1);
    assert.equal(await card("science").locator('a[href*="/receipt"]').count(), 2);
    for (const href of await card("science").locator('a[href*="/receipt"]').evaluateAll(links => links.map(link => link.getAttribute("href")!))) {
      assert.equal(new URL(href, page.url()).searchParams.get("locale"), locale);
    }
    assert.equal(await card("science").locator("tbody tr").first().locator("td").nth(1).textContent(), "US$39.00");
    assert.equal(await card("chinese").getByRole("table").count(), 0);
    assert.equal(await card("science").locator('div[data-colour="science"]').evaluate(e => e.getBoundingClientRect().width), 120);
    assert.equal(await card("science").evaluate(e => e.getBoundingClientRect().x), 384);
    await page.locator('img[src*="/subscriptions/design/"]').evaluateAll(async images => Promise.all(images.map(img => (img as HTMLImageElement).decode())));
    for (const icon of await page.locator('img[src*="/subscriptions/design/"]:visible').all()) assert.equal(await icon.evaluate(e => e.getBoundingClientRect().width), 16);
    await page.screenshot({ path: `${output}/${locale}-current-v4.png`, fullPage: true });
    await card("chinese").getByRole("button", { name: copy.learning.payNow , exact: true }).click();
    await page.getByRole("alert").waitFor(); assert.equal(await page.getByRole("alert").textContent(), "Fixture billing failure");
    const cancel = card("science").getByRole("button", { name: copy.subscriptionDesign.cancelRenewal, exact: true });
    await cancel.click(); const dialog = page.getByRole("dialog"); await dialog.waitFor();
    assert.equal(await dialog.locator("strong").textContent(), locale === "zh-CN" ? "分类 • 科学" : "Category • Science");
    assert.equal(await dialog.getByRole("button").count(), 3);
    assert.ok((await dialog.textContent())?.includes("15 Nov 2026") || locale === "zh-CN");
    await dialog.getByRole("button", { name: copy.cancelDesign.keep, exact: true }).click();
    await dialog.waitFor({ state: "detached" }); assert.equal(requests.length, 0);
    await cancel.click(); await dialog.waitFor();
    await page.setViewportSize({ width: 1440, height: 1024 });
    const bounds = await dialog.boundingBox(); assert.equal(bounds?.width, 600); assert.equal(bounds?.x, 420); assert.equal(bounds?.y, 150);
    const originalIcons = dialog.locator('img'); await originalIcons.evaluateAll(async images => Promise.all(images.map(img => (img as HTMLImageElement).decode())));
    for (const icon of await originalIcons.all()) assert.equal(await icon.evaluate(e => (e as HTMLImageElement).naturalWidth > 0 && e.getBoundingClientRect().width === Number(e.getAttribute("width")) && e.getBoundingClientRect().height === Number(e.getAttribute("height"))), true);
    await page.screenshot({ path: `${output}/${locale}-cancel-v4.png` });
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 500 }]) {
      await page.setViewportSize(viewport);
      assert.equal(await dialog.evaluate(e => e.scrollWidth > e.clientWidth), false);
      const box = await dialog.boundingBox(); assert.ok(box && box.y >= 0 && box.y + box.height <= viewport.height);
      const input = dialog.getByRole("textbox"); await input.fill("Optional feedback");
      assert.equal(await dialog.getByRole("radio").last().isChecked(), true);
      await page.screenshot({ path: `${output}/${locale}-cancel-v4-${viewport.width}.png` });
    }
    const confirm = dialog.getByRole("button", { name: copy.cancelDesign.confirm, exact: true });
    await confirm.evaluate((e: HTMLButtonElement) => { e.click(); e.click(); });
    await dialog.getByRole("alert").waitFor();
    assert.equal(requests.length, 1); assert.equal(await dialog.getByRole("textbox").inputValue(), "Optional feedback");
    assert.equal(await dialog.getByRole("alert").textContent(), copy.subscriptionErrors.provider_unavailable);
    reject = false; await confirm.click(); await dialog.waitFor({ state: "detached" });
    assert.deepEqual(requests[0], requests[1]); assert.deepEqual(requests[1], { subscriptionId: science.id, action: "cancel", reasonCode: "other", reasonText: "Optional feedback" });
    assert.equal(await card("science").getByText(copy.subscriptionDesign.renewalCanceled, { exact: true }).count(), 1);
    assert.equal(await card("science").getByRole("button", { name: copy.subscriptionDesign.cancelRenewal }).count(), 0);
    await card("science").getByRole("button", { name: copy.subscriptionDesign.turnOnRenewal , exact: true }).click();
    await card("science").getByRole("button", { name: copy.subscriptionDesign.cancelRenewal, exact: true }).waitFor();
    assert.equal(requests.at(-1).action, "resume");
    for (const width of [390, 320]) { await page.setViewportSize({ width, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await page.screenshot({ path: `${output}/${locale}-current-v4-${width}.png`, fullPage: true }); }
    // The upgraded product has the original Category payment, rather than a duplicate past card.
    const source = { ...chinese, state: "expired" }, everything = { ...make("everything", "Everything", "active", "2027-01-31"), stripeSubscriptionId: source.stripeSubscriptionId };
    const oldScience = make("old-science", "Science", "expired", "2026-06-30");
    const upgrade = { ...order(everything, "upgrade", "paid", "2026-10-13"), kind: "upgrade", sourceSubscriptionId: source.id, amountMinor: 3586, upgradeProration: { subscriptionId: source.stripeSubscriptionId } };
    await mount("upgraded", [everything, source, oldScience], [upgrade, order(source, "original-category", "paid", "2026-08-01"), order(oldScience, "old-science-paid")]);
    await page.setViewportSize({ width: 1440, height: 1333 });
    await card("everything").waitFor(); assert.equal(await card("chinese").count(), 0);
    const past = page.getByRole("button", { name: `${copy.subscriptionDesign.pastSubscriptions} (1)`, exact: true }); await past.click();
    assert.equal(await past.locator("img").getAttribute("src"), "/portal/subscriptions/design/section-chevron-up.svg");
    await card("everything").getByRole("button", { name: copy.subscriptionDesign.paymentHistory }).click();
    assert.equal(await card("everything").getByRole("row").count(), 3);
    await card("everything").getByRole("button", { name: copy.subscriptionDesign.cancelRenewal, exact: true }).click();
    assert.equal(await dialog.locator("strong").textContent(), copy.pricingDesign.everything);
    await dialog.getByRole("button", { name: copy.cancelDesign.keep, exact: true }).click();
    assert.ok((await card("everything").textContent())?.includes(copy.subscriptionDesign.proratedUpgrade));
    assert.equal(await card("old-science").isVisible(), true);
    await page.screenshot({ path: `${output}/${locale}-past-v4.png`, fullPage: true });
    await mount("legacy-checkout", [everything], [{ ...order(everything, "legacy-everything", "paid", "2026-10-11"), amountMinor: 9900, stripeInvoiceId: null, stripeCheckoutSessionId: "cs-original" }]);
    await card("everything").getByRole("button", { name: copy.subscriptionDesign.paymentHistory }).click();
    assert.equal(await card("everything").locator(`a[href="/api/my-learning/orders/legacy-everything/receipt?locale=${locale}"]`).count(), 1);
    // Supplied Stripe product images remain dynamic.
    await mount("dynamic", [everything], [{ ...order(everything, "dynamic-order"), presentation: { name: "Everything", image: "/test-product.png", termMonths: 6 } }]);
    await card("everything").locator('img[src="/test-product.png"]').waitFor();
    await mount("pending-upgrade", [science], [{ ...order(science, "pending-upgrade", "pending"), kind: "upgrade", quoteId: "quote-pending", upgradeProration: { subscriptionId: science.stripeSubscriptionId } }]);
    await card("science").getByRole("button", { name: copy.subscriptionDesign.cancelRenewal, exact: true }).waitFor();
    assert.equal(await page.locator('a[href*="confirmation?quoteId=quote-pending"]').count(), 1);
    await mount("empty", [], []); await page.locator('a.portal-button[href$="/subscription"]').waitFor();
    assert.equal(await page.locator('[data-subscription-id]').count(), 0);
    await page.close();
  } } finally { await browser.close(); delete (globalThis as any).subscriptionFooter; }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import sharp from "sharp";
import { getMessages } from "../../lib/i18n/messages";
import { buildSubscriptionConfirmationDisplay } from "../../services/subscriptionConfirmationDisplay";
import type { ProductPlan, ProductQuote, ProductSubscription } from "../../services/productStore";

test("Category, Everything and Upgrade confirmations match the design and retain consent, retry and checkout boundaries", async () => {
  const emptyCheckbox = await sharp(await readFile("public/portal/subscription-confirmation/checkbox.svg")).ensureAlpha().extract({ left: 6, top: 6, width: 8, height: 8 }).raw().toBuffer();
  assert.equal(emptyCheckbox.some((value, index) => index % 4 === 3 && value > 0), false, "Unchecked checkbox must have an empty centre");
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {SubscriptionConfirmation} from './components/portal/SubscriptionConfirmation';import {getMessages} from './lib/i18n/messages';const root=createRoot(document.getElementById('root'));window.mount=props=>flushSync(()=>root.render(<SubscriptionConfirmation key={props.key} {...props} copy={getMessages(props.locale).portal.subscriptionConfirmation}/>));` },
    bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "next", setup(b) {
      b.onResolve({ filter: /^next\/(navigation|image)$/ }, args => ({ path: args.path, namespace: "mock" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path === "next/navigation" ? "export const useRouter=()=>({replace(url){window.dismissed=url}})" : "import React from 'react';export default function Image(props){return <img {...props}/>}" }));
    } }],
  });
  const output = "test-results/subscription-confirmation"; await mkdir(output, { recursive: true });
  const browser = await chromium.launch();
  try { for (const locale of ["en-GB", "zh-CN"] as const) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } }), messages = getMessages(locale);
    const errors: string[] = [], requests: unknown[] = []; let responseStatus = 409, release: (() => void) | undefined;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("http://confirmation.test/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.startsWith("/portal/")) return route.fulfill({ body: await readFile(path.join("public", pathname)), contentType: "image/svg+xml" });
      if (pathname === "/api/purchase/checkout" || pathname === "/api/trial") {
        requests.push({ pathname, body: route.request().postDataJSON() });
        if (responseStatus === 202) await new Promise<void>(resolve => { release = resolve; });
        return route.fulfill({ status: responseStatus === 202 ? 409 : responseStatus, json: responseStatus === 200 ? { checkoutUrl: `http://confirmation.test/${locale}/paid` } : { code: "quote_expired" } });
      }
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><div id="root"></div>' });
    });
    await page.goto(`http://confirmation.test/${locale}/portal/subscription/confirmation?quoteId=quote`);
    for (const file of ["app/styles.css", "app/portal-design.css"]) await page.addStyleTag({ content: await readFile(file, "utf8") });
    for (const weight of [400, 500, 600, 700]) { const font = (await readFile(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`)).toString("base64"); await page.addStyleTag({ content: `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font});font-weight:${weight}}` }); }
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const mount = async (kind: "category" | "everything" | "upgrade" | "trial", adjustmentsMinor = 0) => {
      const plan = { id: kind === "category" ? "category-pc-6" : "everything-pc-6", name: kind === "category" ? "Category" : "Everything", scope: kind === "category" ? "category" : "everything", courseId: "*", termMonths: 6, device: "pc", amountMinor: kind === "category" ? 3900 : 9900, aiPoints: kind === "category" ? 500 : 1500, currency: "usd" } as ProductPlan;
      const quote = { id: "quote", kind: kind === "upgrade" ? "upgrade" : kind === "trial" ? "trial" : "purchase", amountMinor: kind === "upgrade" ? 3586 + adjustmentsMinor : kind === "trial" ? 0 : plan.amountMinor, currency: "usd", createdAt: "2026-10-13T00:00:00Z", sourceSubscriptionId: kind === "upgrade" ? "source" : undefined, upgradeProration: kind === "upgrade" ? { periodEnd: Date.parse("2027-02-01T00:00:00Z") / 1000, prorationDate: Date.parse("2026-10-14T00:00:00Z") / 1000, debitMinor: 5918, creditMinor: 2332, adjustmentsMinor } : undefined } as ProductQuote;
      const source = kind === "upgrade" ? { validTo: "2027-02-01T00:00:00Z" } as ProductSubscription : undefined;
      const category = locale === "en-GB" ? "Chinese Humanities" : "中国人文";
      const display = buildSubscriptionConfirmationDisplay({ quote, plan, categoryCount: 3, source, sourcePlan: { ...plan, aiPoints: 500 }, sourceCategory: category });
      await page.evaluate(props => { delete (window as any).dismissed; (window as any).mount(props); }, { key: `${locale}-${kind}-${adjustmentsMinor}`, locale, quote, plan, display, planHeading: kind === "category" ? messages.pricingDesign.category : messages.pricingDesign.everything, planSubtitle: kind === "category" ? category : undefined, scopeDescription: messages.pricingDesign.categoryCourses, upgradeSource: source ? { name: category, validTo: source.validTo } : undefined });
      await page.getByRole("dialog").waitFor();
      await page.evaluate(() => document.fonts.ready);
      return display;
    };
    const dialog = page.getByRole("dialog"), submit = page.locator(".confirmation-actions button");
    for (const kind of ["category", "everything", "upgrade"] as const) {
      await page.setViewportSize({ width: 1440, height: 1024 }); await mount(kind);
      assert.equal(await page.getByRole("checkbox").count(), 3);
      assert.equal(await page.locator('input:checked').count(), 0);
      assert.equal(await submit.isDisabled(), true);
      assert.equal(await submit.textContent(), messages.portal.subscriptionConfirmation.continue);
      assert.equal(await page.locator('img[src$="/checkbox.svg"]').count(), 3);
      await page.keyboard.press("Tab");
      assert.equal(await page.locator(".confirmation-close").evaluate(e => e === document.activeElement), true);
      await page.keyboard.press("Shift+Tab");
      assert.equal(await page.getByRole("checkbox").last().evaluate(e => e === document.activeElement), true);
      await dialog.focus();
      await page.screenshot({ path: `${output}/${locale}-${kind}-desktop.png`, fullPage: true });
      const geometry = await dialog.evaluate(e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return { x: r.x, y: r.y, width: r.width, height: r.height, radius: s.borderRadius, backdrop: getComputedStyle(e, "::backdrop").backgroundColor }; });
      assert.deepEqual(geometry, { x: 292, y: 120, width: 856, height: kind === "upgrade" ? 870 : 850, radius: "20px", backdrop: "rgba(0, 0, 0, 0.4)" });
      const card = page.locator(kind === "upgrade" ? ".upgrade-summary" : ".confirmation-plan");
      const box = (await card.boundingBox())!;
      assert.equal(box.x, 392); assert.equal(box.width, 656); assert.equal(box.y, kind === "upgrade" ? 276 : 246); assert.equal(box.height, kind === "upgrade" ? 212 : 193);
      if (kind === "everything") assert.equal(await page.locator(".confirmation-plan-chip").textContent(), messages.confirmationDetails.allCategories.replace("{count}", "3"));
      if (kind !== "upgrade") {
        assert.match(await page.locator(".confirmation-payment").textContent() || "", /2027/);
        const termDates = await page.locator(".confirmation-payment-grid > div").nth(1).locator("p").textContent();
        const dateLabel = (date: string) => new Date(date).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
        assert.equal(termDates, `${dateLabel("2026-10-13T00:00:00Z")} – ${dateLabel("2027-04-12T00:00:00Z")}`);
      } else {
        assert.match(await page.locator(".upgrade-price").textContent() || "", /110/);
        assert.ok((await page.locator(".upgrade-price").textContent())?.includes("+ US$59.18"));
        assert.ok((await page.locator(".upgrade-price").textContent())?.includes("− US$23.32"));
        assert.match(await page.locator(".upgrade-total").textContent() || "", /US\$35\.86/);
      }
      await dialog.locator("img").evaluateAll(async images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
      for (const icon of await dialog.locator("img").all()) assert.equal(await icon.evaluate(e => { const img = e as HTMLImageElement, r = img.getBoundingClientRect(); return img.complete && img.naturalWidth > 0 && r.width === Number(img.width) && r.height === Number(img.height); }), true);
      assert.equal(await submit.evaluate(e => e.getBoundingClientRect().width), 200);
      await page.screenshot({ path: `${output}/${locale}-${kind}-desktop.png`, fullPage: true });
      for (const input of await page.getByRole("checkbox").all()) await input.check();
      assert.equal(await submit.isEnabled(), true);
      await page.waitForFunction(() => getComputedStyle(document.querySelector(".confirmation-actions button")!).backgroundColor === "rgb(21, 93, 252)");
      assert.equal(await page.locator('img[src$="checkbox-checked.svg"]').count(), 3);
      await page.screenshot({ path: `${output}/${locale}-${kind}-checked.png`, fullPage: true });
      for (const [width, height] of [[390, 844], [320, 700], [1440, 700]]) {
        await page.setViewportSize({ width, height });
        assert.equal(await dialog.evaluate(e => e.scrollWidth > e.clientWidth || e.getBoundingClientRect().right > innerWidth), false);
        await submit.scrollIntoViewIfNeeded(); assert.equal(await submit.isVisible(), true);
        assert.ok((await dialog.boundingBox())!.height <= height - 24);
        if (width === 390) {
          await page.screenshot({ path: `${output}/${locale}-${kind}-mobile.png`, fullPage: true });
          await dialog.evaluate(e => e.scrollTop = 0);
          await page.screenshot({ path: `${output}/${locale}-${kind}-mobile-top.png`, fullPage: true });
        }
      }
      await page.setViewportSize({ width: 1440, height: 1024 });
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => (window as any).dismissed), kind === "upgrade" ? `/${locale}/subscription?upgradeFrom=source` : `/${locale}/subscription?planId=${kind === "category" ? "category-pc-6" : "everything-pc-6"}`);
    }
    await mount("upgrade", 586); assert.match(await page.locator(".upgrade-price").textContent() || "", /US\$5\.86/);
    assert.match(await page.locator(".upgrade-total").textContent() || "", /US\$41\.72/);
    for (const input of await page.getByRole("checkbox").all()) await input.check();
    responseStatus = 202;
    const pendingRequest = page.waitForRequest(r => r.url().endsWith("/api/purchase/checkout"));
    await submit.evaluate((e: HTMLButtonElement) => { e.click(); e.click(); });
    await pendingRequest;
    for (let attempt = 0; !release && attempt < 50; attempt++) await page.waitForTimeout(10);
    assert.equal(requests.length, 1); assert.equal(await submit.isDisabled(), true);
    assert.equal(await page.getByRole("checkbox").first().isDisabled(), true);
    await page.keyboard.press("Escape"); assert.equal(await page.evaluate(() => (window as any).dismissed), undefined);
    release!(); await page.getByRole("alert").waitFor();
    assert.equal(await page.getByRole("alert").textContent(), messages.paymentErrors.quote_expired);
    assert.deepEqual(requests[0], { pathname: "/api/purchase/checkout", body: { quoteId: "quote", locale, consents: { renewal: true, terms: true, refund: true } } });
    assert.equal(await submit.isEnabled(), true);
    await mount("trial"); assert.equal(await page.locator(".confirmation-payment-grid").getByText(messages.confirmationDetails.trialDates).count(), 1);
    for (const input of await page.getByRole("checkbox").all()) await input.check();
    responseStatus = 409; await submit.click(); await page.getByRole("alert").waitFor();
    assert.equal((requests.at(-1) as any).pathname, "/api/trial");
    responseStatus = 401; await submit.click(); await page.waitForURL(`**/${locale}/portal/sign-in?returnTo=*`);
    assert.equal(new URL(page.url()).searchParams.get("returnTo"), `/${locale}/portal/subscription/confirmation?quoteId=quote`);
    assert.deepEqual(errors, []); await page.close();
  } } finally { await browser.close(); }
});

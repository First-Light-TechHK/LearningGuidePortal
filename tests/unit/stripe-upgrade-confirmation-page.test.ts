import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getMessages } from "../../lib/i18n/messages";

test("Stripe upgrade confirmation shows proration, unchanged term and renewal, localised retry and one consented submission", async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {SubscriptionConfirmation} from './components/portal/SubscriptionConfirmation';import {getMessages} from './lib/i18n/messages';const root=createRoot(document.getElementById('root'));window.mount=props=>root.render(<SubscriptionConfirmation key={props.locale} {...props} copy={getMessages(props.locale).portal.subscriptionConfirmation}/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "navigation", setup(b) {
    b.onResolve({ filter: /^next\/(navigation|image)$/ }, args => ({ path: args.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ loader:"tsx",resolveDir:process.cwd(),contents: args.path === "next/navigation" ? "export const useRouter=()=>({replace(url){window.dismissed=url}})" : "import React from 'react';export default function Image(props){return <img {...props}/>}" }));
  } }] });
  await mkdir("test-results/stripe-upgrade-confirmation", { recursive: true });
  const browser = await chromium.launch({ channel: "msedge" });
  try { for (const locale of ["en-GB", "zh-CN"] as const) {
    const copy = getMessages(locale), page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
    let reject = true; const requests: any[] = [];
    await page.route("http://upgrade.test/**", async route => {
      if (new URL(route.request().url()).pathname === "/api/purchase/checkout") {
        requests.push(route.request().postDataJSON());
        return route.fulfill({ status: reject ? 409 : 200, json: reject ? { code: "quote_expired" } : { checkoutUrl: `http://upgrade.test/${locale}/account/my-learning/subscription?orderId=order-native` } });
      }
      return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    });
    await page.goto(`http://upgrade.test/${locale}/portal/subscription/confirmation?quoteId=quote-native`);
    for (const file of ["app/styles.css", "app/portal-design.css"]) await page.addStyleTag({ content: await readFile(file, "utf8") });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(props => (window as any).mount(props), { locale, quote: { id: "quote-native", kind: "upgrade", amountMinor: 3586, currency: "usd", creditMinor: 3000, sourceSubscriptionId: "local-source", upgradeProration: { subscriptionId: "sub_original", customerId: "cus_original", itemId: "si_original", sourcePriceId: "price_category_6", periodStart: 1785542400, periodEnd: 1801353600, billingCycleAnchor: 1785542400, prorationDate: 1792195200, debitMinor: 6000, creditMinor: 3000, adjustmentsMinor: 586, invoiceTotalMinor: 3586, amountDueMinor: 3586 } }, plan: { id: "everything-pc-6", name: "Everything", termMonths: 6, device: "pc", amountMinor: 9900, currency: "usd" }, planHeading: "Everything", scopeDescription: "All categories", upgradeSource: { name: "Category", validTo: "2027-01-31T00:00:00Z" } });
    const dialog = page.getByRole("dialog"); await dialog.waitFor();
    const price = page.locator(".upgrade-price");
    assert.match(await price.textContent() || "", /\$60\.00 USD/);
    assert.match(await price.textContent() || "", /\$30\.00 USD/);
    assert.match(await price.textContent() || "", /\$5\.86 USD/);
    assert.match(await price.textContent() || "", /\$35\.86 USD/);
    assert.match(await page.locator(".upgrade-renewal-note").textContent() || "", /\$99\.00 USD \/ 6/);
    assert.ok((await page.locator(".upgrade-validity").textContent())?.includes("2027"));
    assert.ok((await price.textContent())?.includes(copy.upgradeConfirmation.remainingPrice));
    const submit = page.locator(".confirmation-actions button").last();
    assert.equal(await submit.isDisabled(), true);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1024 });
      assert.equal(await dialog.evaluate(e => e.scrollWidth > e.clientWidth), false, `${locale}/${width} overflow`);
      await page.screenshot({ path: `test-results/stripe-upgrade-confirmation/${locale}-${width}.png`, fullPage: true });
    }
    for (const input of await page.getByRole("checkbox").all()) await input.check();
    await submit.evaluate((e: HTMLButtonElement) => { e.click(); e.click(); });
    await page.getByRole("alert").waitFor();
    assert.equal(requests.length, 1);
    assert.equal(await page.getByRole("alert").textContent(), copy.paymentErrors.quote_expired);
    assert.deepEqual(requests[0], { quoteId: "quote-native", locale, consents: { renewal: true, terms: true, refund: true } });
    reject = false; await submit.click();
    await page.waitForURL(`**/${locale}/account/my-learning/subscription?orderId=order-native`);
    assert.equal(requests.length, 2); await page.close();
  } } finally { await browser.close(); }
});

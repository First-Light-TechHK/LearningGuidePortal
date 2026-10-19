import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultPortalContent } from "../../lib/portalContent";
import { getMessages } from "../../lib/i18n/messages";
import { buildSubscriptionSelection } from "../../services/subscriptionSelection";
import type { ProductPlan, ProductSubscription } from "../../services/productStore";

test("five subscription designs retain bilingual responsive states, original icons and bounded purchase/upgrade actions", async () => {
  const output = "test-results/subscription-selection"; await mkdir(output, { recursive: true });
  const footerBundle = await build({ entryPoints: ["components/portal/PortalFooter.tsx"], bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", external: ["react", "react/jsx-runtime"], plugins: [{ name: "footer", setup(b) {
    b.onResolve({ filter: /^next\/|services\/productStore$/ }, args => ({ path: args.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path.endsWith("productStore") ? "export async function getPortalContent(){return globalThis.selectionFooter}" : "import React from 'react';export default function Component({prefetch,...p}){return p.src?<img {...p}/>:<a {...p}/>}" }));
  } }] });
  const filename = path.resolve(output, "footer.cjs"); await writeFile(filename, footerBundle.outputFiles[0].text); (globalThis as any).selectionFooter = defaultPortalContent;
  const Footer = createRequire(import.meta.url)(filename).PortalFooter;
  const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {SubscriptionSelection} from './components/portal/SubscriptionSelection';import {PortalHeader} from './components/portal/PortalHeader';import {getMessages} from './lib/i18n/messages';const root=createRoot(document.getElementById('root'));window.mount=p=>{const copy=getMessages(p.locale).pricingDesign;flushSync(()=>root.render(<main className="portal-page pricing-design-page"><PortalHeader locale={p.locale} signedIn active="subscription" displayName="M"/><section className="pricing-design-main"><SubscriptionSelection key={p.key} {...p} copy={copy}/></section><section className="pricing-design-information"><div><h2>{copy.information}</h2><div className="pricing-information-grid">{copy.rules.map(r=><div key={r.title}><h3>{r.title}</h3><p>{r.text}</p></div>)}</div></div></section><div dangerouslySetInnerHTML={{__html:p.footer}}/></main>))}`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, outfile: "selection.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "next", setup(b) {
    b.onResolve({ filter: /^next\/(image|link|navigation)$/ }, args => ({ path: args.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path === "next/navigation" ? "export const useRouter=()=>({refresh(){}}),usePathname=()=>location.pathname,useSearchParams=()=>new URLSearchParams(location.search)" : args.path === "next/link" ? "import React from 'react';export default function Link({prefetch,...p}){return <a {...p}/>}" : "import React from 'react';export default function Image({unoptimized,...p}){return <img {...p}/>}" }));
  } }] });
  const categories = defaultPortalContent.categories;
  const plans: ProductPlan[] = ([6, 12] as const).flatMap(termMonths => [{ id: `everything-${termMonths}`, courseId: "*", name: "Everything", scope: "everything", scopeId: "*", termMonths, device: "pc", amountMinor: termMonths === 6 ? 9900 : 19800, currency: "usd", aiPoints: 1500 }, ...categories.map(category => ({ id: `${category.id}-${termMonths}`, courseId: "*", name: category.id, scope: "category" as const, scopeId: category.id, termMonths, device: "pc" as const, amountMinor: termMonths === 6 ? 3900 : 7800, currency: "usd" as const, aiPoints: 500 }))]);
  const courseTitles = [{ category: "Chinese Humanities", title: "Chinese History" }, { category: "Chinese Humanities", title: "Chinese Literature" }, { category: "European Humanities", title: "The Art of Seeing" }, { category: "European Humanities", title: "Renaissance Thought" }, { category: "Science", title: "Physics" }, { category: "Science", title: "Chemistry" }];
  const subscription = (scopeId: string): ProductSubscription => ({ id: `sub-${scopeId}`, userId: "owner", planId: `${scopeId}-6`, courseId: "*", scope: scopeId === "everything" ? "everything" : "category", scopeId, device: "pc", stripeSubscriptionId: "sub_stripe", stripeCustomerId: "cus_owner", source: "purchase", state: "active", cancelAtPeriodEnd: false, validFrom: "2026-08-01T00:00:00Z", validTo: "2027-01-31T00:00:00Z" });
  const fixtures = [[], [subscription("Chinese Humanities")], [subscription("Chinese Humanities"), subscription("Science")], categories.map(c => subscription(c.id)), [subscription("everything")]];
  const browser = await chromium.launch();
  try { for (const locale of ["en-GB", "zh-CN"] as const) {
    const copy = getMessages(locale), page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
    let mode = "success", amountMinor = 3586; const requests: any[] = [];
    await page.route("http://selection.test/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/api/subscription/quote") { requests.push(route.request().postDataJSON()); return route.fulfill({ status: mode === "success" ? 200 : mode === "anonymous" ? 401 : 400, json: mode === "success" ? { quote: { id: "trusted-quote", amountMinor, currency: "usd", expiresAt: new Date(Date.now() + 600000).toISOString() } } : { code: "upgrade_unavailable", error: copy.paymentErrors.upgrade_unavailable } }); }
      if (pathname.startsWith("/portal/")) return route.fulfill({ body: await readFile(path.join("public", pathname)), contentType: "image/svg+xml" });
      return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    });
    await page.goto(`http://selection.test/${locale}/subscription`);
    for (const file of ["app/styles.css", "app/portal-design.css"]) await page.addStyleTag({ content: await readFile(file, "utf8") });
    for (const weight of [400, 500, 600, 700]) await page.addStyleTag({ content: `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${(await readFile(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`)).toString("base64")});font-weight:${weight}}` });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const footer = renderToStaticMarkup(await Footer({ locale }));
    const propsFor = (index: number) => { const selection = buildSubscriptionSelection(fixtures[index], plans, "owner", Date.parse("2026-10-13T00:00:00Z")); return { locale, key: `${index}`, selection, categories, courseTitles, footer, plans: plans.map(p => ({ ...p, alreadySubscribed: selection.kind === "everything" || selection.ownedCategoryIds.includes(p.scopeId || "") })) }; };
    const mount = (index: number) => page.evaluate(p => (window as any).mount(p), propsFor(index));
    for (let index = 0; index < fixtures.length; index++) {
      await mount(index); const kind = propsFor(index).selection.kind;
      if (index === 0) assert.equal(await page.locator(".pricing-design-card").count(), 2);
      if (index === 1) { await page.locator(".pricing-upgrade-action button").waitFor({ state: "visible" }); await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>(".pricing-upgrade-action button")?.disabled); assert.equal(await page.locator(".pricing-upgrade-action button").isEnabled(), true); assert.equal(await page.locator(".pricing-upgrade-card .pricing-card-price strong").textContent(), "$35.86"); }
      if (index === 2) { assert.equal(await page.locator(".pricing-upgrade-action").count(), 0); assert.equal(await page.locator(".pricing-design-card").count(), 1); assert.equal(await page.locator(".pricing-category-switch button").count(), 1); }
      if (index >= 3) { assert.equal(await page.locator(".pricing-design-card").count(), 0); assert.equal(await page.locator(".pricing-owned-benefits").count(), 1); assert.equal(await page.locator(".pricing-owned-status > a").getAttribute("href"), `/${locale}/account/my-learning/subscription`); }
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1024 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${locale}/${kind}/${width} overflow`);
        await page.evaluate(() => document.fonts.ready);
        const icons = page.locator('img[src*="/subscription-selection/"]'); await icons.evaluateAll(async images => Promise.all(images.map(img => (img as HTMLImageElement).decode())));
        for (const icon of await icons.all()) assert.equal(await icon.evaluate(e => { const img = e as HTMLImageElement; return img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().width === Number(img.getAttribute("width")) && img.getBoundingClientRect().height === Number(img.getAttribute("height")); }), true);
        await page.screenshot({ path: `${output}/${locale}-${kind}-${width}.png`, fullPage: true });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1024 }); await mount(2);
    await page.getByRole("button", { name: copy.pricingDesign.year, exact: true }).click();
    assert.equal(await page.locator(".pricing-card-price strong").textContent(), "$78");
    mode = "error"; await page.locator(".purchase-actions button").click(); await page.getByRole("alert").waitFor(); assert.equal(requests.at(-1).planId, "European Humanities-12");
    mode = "error"; requests.length = 0; await mount(1);
    await page.getByRole("alert").waitFor(); assert.equal(requests.length, 1); assert.deepEqual(requests[0], { kind: "upgrade", subscriptionId: "sub-Chinese Humanities" });
    assert.equal(await page.locator(".pricing-upgrade-action button").last().isDisabled(), true);
    assert.equal(await page.locator(".pricing-upgrade-card .pricing-card-price strong").textContent(), "—");
    mode = "success"; amountMinor = 1467; await page.getByRole("button", { name: copy.subscriptionSelection.quoteRetry, exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".pricing-upgrade-card .pricing-card-price strong")?.textContent === "$14.67");
    assert.equal(await page.locator(".pricing-upgrade-card .pricing-card-price strong").textContent(), "$14.67");
    assert.ok((await page.locator(".pricing-upgrade-action button").last().textContent())?.includes("$14.67"));
    const quoteRequests = requests.length;
    await page.locator(".pricing-upgrade-action button").last().click(); await page.waitForURL(`**/${locale}/portal/subscription/confirmation?quoteId=trusted-quote`);
    assert.equal(requests.length, quoteRequests, "the displayed Stripe quote is reused without replacing its price on click");
    await page.close();
  } } finally { await browser.close(); delete (globalThis as any).selectionFooter; }
});

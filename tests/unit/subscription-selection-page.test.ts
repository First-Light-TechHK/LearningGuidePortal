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
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path === "next/navigation" ? "const router={refresh(){}};export const useRouter=()=>router,usePathname=()=>location.pathname,useSearchParams=()=>new URLSearchParams(location.search)" : args.path === "next/link" ? "import React from 'react';export default function Link({prefetch,...p}){return <a {...p}/>}" : "import React from 'react';export default function Image({unoptimized,...p}){return <img {...p}/>}" }));
  } }] });
  const categories = defaultPortalContent.categories;
  const plans: ProductPlan[] = ([6, 12] as const).flatMap(termMonths => [{ id: `everything-${termMonths}`, courseId: "*", name: "Everything", scope: "everything", scopeId: "*", termMonths, device: "pc", amountMinor: termMonths === 6 ? 9900 : 19800, currency: "usd", aiPoints: termMonths === 6 ? 1500 : 3100 }, ...categories.map(category => ({ id: `${category.id}-${termMonths}`, courseId: "*", name: category.id, scope: "category" as const, scopeId: category.id, termMonths, device: "pc" as const, amountMinor: termMonths === 6 ? 3900 : 7800, currency: "usd" as const, aiPoints: termMonths === 6 ? 500 : 1100 }))]);
  const courseTitles = [{ category: "Chinese Humanities", title: "Chinese History" }, { category: "Chinese Humanities", title: "Chinese Literature" }, { category: "European Humanities", title: "The Art of Seeing" }, { category: "European Humanities", title: "Renaissance Thought" }, { category: "Science", title: "Physics" }, { category: "Science", title: "Chemistry" }, ...Array.from({length:8},(_,index)=>({category:"European Humanities",title:`European Art and Philosophy ${index+1}`}))];
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
    // The component's own CSS modules (PortalHeader included) are emitted by the
    // bundle above; a real browser receives them. Injecting only the two global
    // sheets left the header with desktop layout at 390px, so the overflow check
    // was measuring a header with no mobile styles at all.
    const bundleCss = bundle.outputFiles.find(file => file.path.endsWith(".css"));
    if (bundleCss) await page.addStyleTag({ content: bundleCss.text });
    for (const weight of [400, 500, 600, 700]) await page.addStyleTag({ content: `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${(await readFile(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`)).toString("base64")});font-weight:${weight}}` });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const footer = renderToStaticMarkup(await Footer({ locale }));
    const propsFor = (index: number) => { const selection = buildSubscriptionSelection(fixtures[index], plans, "owner", Date.parse("2026-10-13T00:00:00Z")); return { locale, key: `${index}`, selection, categories, courseTitles, footer, plans: plans.map(p => ({ ...p, alreadySubscribed: selection.kind === "everything" || selection.ownedCategoryIds.includes(p.scopeId || "") })) }; };
    const mount = (index: number) => page.evaluate(p => (window as any).mount(p), propsFor(index));
    for (let index = 0; index < fixtures.length; index++) {
      await mount(index); const kind = propsFor(index).selection.kind;
      if (index === 0) assert.equal(await page.locator(".pricing-design-card").count(), 2);
      if (index === 0) {
        for(const viewport of [{width:1280,height:640},{width:1366,height:650},{width:1440,height:768},{width:1536,height:864},{width:1920,height:900},{width:1024,height:768}]) {
          await page.setViewportSize(viewport);
          for(const term of [copy.pricingDesign.sixMonths,copy.pricingDesign.year]) {
            await page.getByRole("button",{name:term,exact:true}).click();
            await page.waitForFunction(()=>getComputedStyle(document.querySelector('.pricing-title-row [aria-pressed=true]')!).backgroundColor==="rgb(21, 93, 252)");
            await page.evaluate(()=>{scrollTo(0,0);return document.fonts.ready;});
            const geometry=await page.evaluate(()=>({
              viewport:innerHeight,
              topGap:document.querySelector('.pricing-title-row')!.getBoundingClientRect().top-document.querySelector('.portal-header')!.getBoundingClientRect().bottom,
              titleGap:document.querySelector('.pricing-comparison')!.getBoundingClientRect().top-document.querySelector('.pricing-title-row')!.getBoundingClientRect().bottom,
              actions:Array.from(document.querySelectorAll<HTMLElement>('.pricing-design-card .purchase-actions button')).map(button=>({top:button.getBoundingClientRect().top,bottom:button.getBoundingClientRect().bottom,height:button.getBoundingClientRect().height,font:parseFloat(getComputedStyle(button).fontSize),scroll:button.scrollHeight,client:button.clientHeight})),
              cards:Array.from(document.querySelectorAll('.pricing-design-card')).map(card=>card.getBoundingClientRect().bottom),
              overflow:document.documentElement.scrollWidth>innerWidth,
            }));
            assert.ok(geometry.topGap<=24 && geometry.titleGap<=20,`${locale}/${viewport.width}x${viewport.height}: compact heading spacing`);
            assert.equal(geometry.actions.length,2);
            for(const action of geometry.actions) {
              assert.ok(action.top>0 && action.bottom<=geometry.viewport-8,`${locale}/${viewport.width}x${viewport.height}/${term}: action stays fully in the initial viewport: ${JSON.stringify(geometry)}`);
              assert.ok(action.height>=44 && action.font>=14 && action.scroll<=action.client,"purchase action remains readable and operable");
            }
            assert.ok(geometry.cards.every(bottom=>bottom<=geometry.viewport-8),"complete cards fit without clipping");
            assert.equal(geometry.overflow,false);
          }
          await page.screenshot({path:`${output}/${locale}-compact-${viewport.width}x${viewport.height}.png`});
        }
        await page.setViewportSize({width:1440,height:1024});
        // Reset the plan and let viewport-dependent styles settle before the existing fixed-layout checks.
        await mount(index);
        await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
      }
      if (index === 1) { await page.locator(".pricing-upgrade-action button").waitFor({ state: "visible" }); await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>(".pricing-upgrade-action button")?.disabled); assert.equal(await page.locator(".pricing-upgrade-action button").isEnabled(), true); assert.equal(await page.locator(".pricing-upgrade-card .pricing-card-price strong").textContent(), "US$35.86"); }
      if (index === 2) { assert.equal(await page.locator(".pricing-upgrade-action").count(), 0); assert.equal(await page.locator(".pricing-design-card").count(), 1); assert.equal(await page.locator(".pricing-category-switch button").count(), 1); }
      if (index >= 3) { assert.equal(await page.locator(".pricing-design-card").count(), 0); assert.equal(await page.locator(".pricing-owned-benefits").count(), 1); assert.equal(await page.locator(".pricing-owned-status > a").getAttribute("href"), `/${locale}/account/my-learning/subscription`); }
      if (index === 1) {
        const upgrade = page.locator('.pricing-upgrade-card'), category = page.locator('.pricing-design-card--category');
        const assertActions=async(selected:"everything"|"category")=>{
          await page.waitForFunction(()=>Array.from(document.querySelectorAll('.pricing-design-card .purchase-actions button,.pricing-upgrade-action button')).every(button=>getComputedStyle(button).backgroundColor===(button.closest('[data-selected]')?.getAttribute('data-selected')==='true'?'rgb(36, 107, 253)':'rgb(255, 255, 255)')));
          // The page-wide wait above can settle before a focus/selection change repaints
          // the individual button (observed as rgb(254, 255, 255) on a slower runner).
          // Waiting per selector keeps the expected colours while tolerating that repaint;
          // if focus genuinely changed a colour this times out with the settled values.
          for(const [selector,active] of [['.pricing-upgrade-action button',selected==="everything"],['.purchase-actions button',selected==="category"]] as const){
            const expected={background:active?"rgb(36, 107, 253)":"rgb(255, 255, 255)",color:active?"rgb(255, 255, 255)":"rgb(21, 93, 252)"};
            await page.waitForFunction(({sel,want})=>{
              const el=document.querySelector(sel);
              if(!el) return false;
              const style=getComputedStyle(el);
              return style.backgroundColor===want.background && style.color===want.color;
            },{sel:selector,want:expected},{timeout:5_000});
            const button=selector.startsWith('.pricing-upgrade-action')?upgrade.locator('.pricing-upgrade-action button'):category.locator('.purchase-actions button');
            assert.equal(await button.evaluate(e=>getComputedStyle(e).backgroundColor),expected.background);
            assert.equal(await button.evaluate(e=>getComputedStyle(e).color),expected.color);
          }
        };
        assert.equal(await upgrade.getAttribute("data-selected"), "true");
        await assertActions("everything");
        const before = requests.length;
        await category.locator('.pricing-category-switch button').first().click();
        assert.equal(await category.getAttribute("data-selected"), "true");
        assert.equal(await upgrade.getAttribute("data-selected"), "false");
        assert.equal(await category.evaluate(e => getComputedStyle(e).borderTopColor), "rgb(36, 107, 253)");
        await assertActions("category");
        await upgrade.locator('.pricing-upgrade-action button').focus();
        assert.equal(await upgrade.getAttribute("data-selected"), "true");
        await assertActions("everything");
        assert.equal(await page.locator('.pricing-design-card[data-selected="true"]').count(), 1);
        assert.equal(requests.length, before, "product selection alone must not request checkout or another quote");
      }
      if (index === 2) {
        assert.equal(await page.locator('.pricing-design-card--category').getAttribute("data-selected"), "true");
        assert.equal(await page.locator('.purchase-actions button').evaluate(e=>getComputedStyle(e).backgroundColor),"rgb(36, 107, 253)");
      }
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1024 });
        const categoryCard=page.locator('.pricing-design-card--category');
        if(await categoryCard.count()) {
          const courseList=categoryCard.locator('.pricing-card-course-list > p');
          const summaryBox=()=>categoryCard.locator('.pricing-card-course-list').evaluate(e=>{const r=e.getBoundingClientRect();return {y:r.y+scrollY,height:r.height};});
          const before=await summaryBox();
          for(const button of await categoryCard.locator('.pricing-category-switch button:enabled').all()) {
            await button.click();
            assert.equal(await courseList.evaluate(e=>e.getBoundingClientRect().height),44,`${kind}/${width}: course lists reserve exactly two lines`);
            assert.equal(await courseList.evaluate(e=>getComputedStyle(e).webkitLineClamp),"2");
            assert.deepEqual(await summaryBox(),before,`${kind}/${width}: category changes retain the Course area height and note position`);
          }
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${locale}/${kind}/${width} overflow`);
        await page.evaluate(() => document.fonts.ready);
        const icons = page.locator('img[src*="/subscription-selection/"]'); await icons.evaluateAll(async images => Promise.all(images.map(img => (img as HTMLImageElement).decode())));
        for (const icon of await icons.all()) assert.equal(await icon.evaluate(e => { const img = e as HTMLImageElement; return img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().width === Number(img.getAttribute("width")) && img.getBoundingClientRect().height === Number(img.getAttribute("height")); }), true);
        await page.screenshot({ path: `${output}/${locale}-${kind}-${width}.png`, fullPage: true });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1024 }); await mount(2);
    await page.getByRole("button", { name: copy.pricingDesign.year, exact: true }).click();
    assert.equal(await page.locator(".pricing-card-price strong").textContent(), "US$78.00");
    assert.equal(await page.locator('.pricing-card-benefits strong').textContent(),'1,100');
    mode = "error"; await page.locator(".purchase-actions button").click(); await page.getByRole("alert").waitFor(); assert.equal(requests.at(-1).planId, "European Humanities-12");
    mode = "error"; requests.length = 0; await mount(1);
    await page.getByRole("alert").waitFor(); assert.equal(requests.length, 1); assert.deepEqual(requests[0], { kind: "upgrade", subscriptionId: "sub-Chinese Humanities" });
    assert.equal(await page.locator(".pricing-upgrade-action button").last().isDisabled(), true);
    assert.equal(await page.locator(".pricing-upgrade-action button").last().evaluate(e=>getComputedStyle(e).backgroundColor),"rgb(152, 162, 179)");
    assert.equal(await page.locator(".pricing-upgrade-card .pricing-card-price strong").textContent(), "—");
    mode = "success"; amountMinor = 1467; await page.getByRole("button", { name: copy.subscriptionSelection.quoteRetry, exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".pricing-upgrade-card .pricing-card-price strong")?.textContent === "US$14.67");
    assert.equal(await page.locator(".pricing-upgrade-card .pricing-card-price strong").textContent(), "US$14.67");
    assert.ok((await page.locator(".pricing-upgrade-action button").last().textContent())?.includes("US$14.67"));
    const quoteRequests = requests.length;
    await page.locator(".pricing-upgrade-action button").last().click(); await page.waitForURL(`**/${locale}/portal/subscription/confirmation?quoteId=trusted-quote`);
    assert.equal(requests.length, quoteRequests, "the displayed Stripe quote is reused without replacing its price on click");
    await page.close();
  } } finally { await browser.close(); delete (globalThis as any).selectionFooter; }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

test("Subscription products start collapsed, expand independently, preserve billing errors and work in both locales", async () => {
  const bundle = await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {SubscriptionManager} from './components/portal/SubscriptionManager';import {AccountNav} from './components/portal/AccountNav';import {getMessages} from './lib/i18n/messages';import styles from './components/portal/subscription-records.module.css';const root=createRoot(document.getElementById('root'));window.mount=props=>root.render(<main className={'portal-page portal-account-page '+styles.page}><header className="portal-header" style={{height:68}}>Learning Guide</header><AccountNav locale={props.locale} copy={getMessages(props.locale).account}/><section className={styles.content}><div className={styles.inner}><h1>{getMessages(props.locale).account.subscription}</h1><p className={styles.intro}>{getMessages(props.locale).subscriptionDesign.intro}</p><SubscriptionManager key={props.key} {...props} copy={getMessages(props.locale).learning}/></div></section></main>);`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, outfile: "subscription.js", platform: "browser", external: ["/portal/*"], jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "next", setup(builder) {
      builder.onResolve({ filter: /^next\/(image|link|navigation)$/ }, args => ({ path: args.path, namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ resolveDir: process.cwd(), contents: args.path === "next/navigation" ? `export function usePathname(){return location.pathname}` : args.path === "next/link" ? `import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/ >}` : `import React from 'react';export default function Image({unoptimized,...props}){return <img {...props}/ >}`, loader: "tsx" }));
    } }],
  });
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge" });
  await mkdir("test-results/subscription-records", { recursive: true });
  const products = ["Everything","Chinese Humanities","Science","European Humanities"];
  const images = ["everything","chinese_human","science","european_human"];
  const initialSubscriptions = products.map((name,index) => ({id:`sub-${index}`,source:"purchase",state:["active","cancel_at_period_end","grace","expired"][index],validFrom:"2026-08-01",validTo:"2027-01-31",graceEndsAt:"2026-09-03",stripeSubscriptionId:`stripe-${index}`,plan:{id:`plan-${index}`,name}}));
  const initialOrders = products.flatMap((name,index) => [0,1].map(renewal => ({id:`order-${index}-${renewal}`,stripeSubscriptionId:`stripe-${index}`,status:index === 2 && renewal === 0 ? "failed" : "paid",amountMinor:9900,currency:"USD",paymentMode:"stripe",stripeInvoiceId:renewal === 1 ? null : `invoice-${index}`,createdAt:renewal ? "2026-02-01" : "2026-08-01",servicePeriodStart:"2026-08-01",servicePeriodEnd:"2027-01-31",plan:{id:`plan-${index}`,name},presentation:{name,image:`/portal/subscriptions/${images[index]}.png`,termMonths:6}})));
  try {
    for (const locale of ["en-GB", "zh-CN"]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1333 } });
      let reject = true; const requests: unknown[] = [];
      await page.route("http://subscription.test/**", async route => {
        const url = new URL(route.request().url());
        if (url.pathname === "/api/subscription") { requests.push(route.request().postDataJSON()); return route.fulfill({status:reject ? 500 : 200,contentType:"application/json",body:reject ? '{"error":"Fixture cancellation failure"}' : JSON.stringify({subscription:{...initialSubscriptions[0],state:"cancel_at_period_end"}})}); }
        if (url.pathname === "/api/subscription/portal") return route.fulfill({status:500,contentType:"application/json",body:'{"error":"Fixture billing failure"}'});
        if (url.pathname.startsWith("/portal/")) return route.fulfill({ body: await readFile(path.join("public", url.pathname)), contentType: url.pathname.endsWith("svg") ? "image/svg+xml" : "image/png" });
        return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      });
      await page.goto(`http://subscription.test/${locale}/account/my-learning/subscription`);
      for (const file of ["app/styles.css", "app/portal-design.css"]) await page.addStyleTag({ content: await readFile(file, "utf8") });
      await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith("css"))!.text });
      for (const weight of [400, 500, 600, 700]) {
        const font = (await readFile(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`)).toString("base64");
        await page.addStyleTag({ content: `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font});font-weight:${weight}}` });
      }
      await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith("js"))!.text });
      const mount = (empty = false) => page.evaluate(props => (window as unknown as {mount:(props:unknown)=>void}).mount(props), {locale,key:empty ? "empty" : locale,initialSubscriptions:empty ? [] : initialSubscriptions,initialOrders:empty ? [] : initialOrders});
      await mount();
      const cards = page.locator('[data-subscription-id]'); await cards.first().waitFor();
      assert.equal(await cards.count(),4);
      assert.equal(await page.getByRole("table").count(),0);
      assert.equal(await cards.locator('button[aria-expanded="false"]').count(),4);
      assert.deepEqual(await cards.locator('img').evaluateAll(nodes => nodes.flatMap(node => { const image = node as HTMLImageElement; return image.src?.endsWith("svg") ? [] : [new URL(image.src).pathname]; })),images.map(image => `/portal/subscriptions/${image}.png`));
      await page.screenshot({path:`test-results/subscription-records/${locale}-collapsed.png`});
      await cards.nth(0).locator('button[aria-expanded]').click();
      await page.getByRole("table").waitFor();
      assert.equal(await page.getByRole("table").count(),1);
      assert.equal(await cards.nth(1).getByRole("table").count(),0);
      assert.equal(await cards.nth(0).locator('a[href*="/receipt"]').count(),1);
      await page.screenshot({path:`test-results/subscription-records/${locale}-expanded.png`});
      await cards.nth(0).locator('button[aria-expanded]').click();
      assert.equal(await page.getByRole("table").count(),0);
      await cards.nth(2).locator('button[aria-expanded]').click();
      assert.equal(await cards.nth(2).locator('a[href*="/receipt"]').count(),0,"failed payments and unavailable invoices have no receipt link");
      await cards.nth(2).getByRole("button",{name:locale === "zh-CN" ? "立即支付 →" : "Pay now →",exact:true}).click();
      await page.getByRole("alert").waitFor();
      assert.equal(await page.getByRole("alert").first().textContent(),"Fixture billing failure");
      await cards.nth(0).getByRole("button",{name:locale === "zh-CN" ? "取消自动续订" : "Cancel auto-renewal",exact:true}).click();
      const dialog = page.getByRole("dialog"); await dialog.waitFor();
      const confirm = dialog.getByRole("button",{name:locale === "zh-CN" ? "确认取消" : "Confirm cancellation",exact:true});
      await confirm.click(); await dialog.getByRole("alert").waitFor();
      assert.equal(await dialog.isVisible(),true);
      reject=false;await confirm.click();await dialog.waitFor({state:"detached"});
      assert.equal(requests.length,2);
      assert.equal(await cards.nth(0).getByRole("button",{name:locale === "zh-CN" ? "取消自动续订" : "Cancel auto-renewal",exact:true}).count(),0);
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:`test-results/subscription-records/${locale}-mobile.png`,fullPage:true});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
      await mount(true);await cards.first().waitFor({state:"detached"});
      assert.equal(await page.locator('a[href$="/pricing"]').count(),1);
      await page.close();
    }
  } finally { await browser.close(); }
});

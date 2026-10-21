import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultPortalContent } from "../../lib/portalContent";
import { getMessages } from "../../lib/i18n/messages";

test("Subscription Figma layout and shared full-width footer in both locales", async () => {
  const footerBundle = await build({ entryPoints:["components/portal/PortalFooter.tsx"],bundle:true,write:false,platform:"node",format:"cjs",jsx:"automatic",external:["react","react/jsx-runtime"],plugins:[{name:"server",setup(b){
    b.onResolve({filter:/^next\/|services\/productStore$/},args=>({path:args.path,namespace:"mock"}));
    b.onLoad({filter:/.*/,namespace:"mock"},args=>({loader:"tsx",contents:args.path.endsWith("productStore")?"export async function getPortalContent(){return globalThis.footerContent}":"import React from 'react';export default function Component({prefetch,...props}){return props.src?<img {...props}/>:<a {...props}/>}",resolveDir:process.cwd()}));
  }}] });
  await mkdir("test-results/subscription-design",{recursive:true});
  const filename=path.resolve("test-results/subscription-design/footer.cjs");await writeFile(filename,footerBundle.outputFiles[0].text);
  (globalThis as any).footerContent=defaultPortalContent;
  const Footer=createRequire(import.meta.url)(filename).PortalFooter;
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PricingPlans} from './components/portal/PricingPlans';import {getMessages} from './lib/i18n/messages';import styles from './components/portal/subscription-records.module.css';const root=createRoot(document.getElementById('root'));window.mount=p=>{const copy=getMessages(p.locale).pricingDesign;flushSync(()=>root.render(p.account?<main className={'portal-page portal-account-page '+styles.page}><header className="portal-header"/><nav className="account-nav"/><section className={styles.content}><div className={styles.inner}><h1>My Subscription</h1></div></section><div className="footer-slot" dangerouslySetInnerHTML={{__html:p.footer}}/></main>:<main className="portal-page pricing-design-page"><header className="portal-header" style={{height:68}}/><section className="pricing-design-main"><PricingPlans {...p} copy={copy}/></section><section className="pricing-design-information"><div><h2>{copy.information}</h2><div className="pricing-information-grid">{copy.rules.map(rule=><div key={rule.title}><h3>{rule.title}</h3><p>{rule.text}</p></div>)}</div></div></section><div dangerouslySetInnerHTML={{__html:p.footer}}/></main>))}`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,outfile:"design.js",platform:"browser",jsx:"automatic",loader:{".css":"local-css"},plugins:[{name:"next",setup(b){b.onResolve({filter:/^next\//},args=>({path:args.path,namespace:"mock"}));b.onLoad({filter:/.*/,namespace:"mock"},()=>({contents:"export function useRouter(){return {refresh(){}}}",loader:"tsx"}));}}]});
  const categories=defaultPortalContent.categories;
  const plans=([6,12] as const).flatMap(termMonths=>[{id:`all-${termMonths}`,name:"Everything",scope:"everything",scopeId:"*",termMonths,device:"pc",amountMinor:termMonths===6?9900:19800,currency:"usd",aiPoints:1500},...categories.map(c=>({id:`${c.id}-${termMonths}`,name:c.labels['en-GB'],scope:"category",scopeId:c.id,termMonths,device:"pc",amountMinor:termMonths===6?3900:7800,currency:"usd",aiPoints:500}))]);
  const browser=await chromium.launch();
  try {for(const locale of ["en-GB","zh-CN"]){
    const page=await browser.newPage();
    await page.route("http://design.test/**",async route=>{const pathname=new URL(route.request().url()).pathname;if(pathname.startsWith("/portal/"))return route.fulfill({body:await readFile(path.join("public",pathname)),contentType:"image/svg+xml"});return route.fulfill({body:'<div id="root"></div>',contentType:"text/html"});});
    await page.goto("http://design.test/");
    for(const file of ["app/styles.css","app/portal-design.css"])await page.addStyleTag({content:await readFile(file,"utf8")});
    await page.addStyleTag({content:bundle.outputFiles.find(f=>f.path.endsWith("css"))!.text+".footer-slot{grid-column:1/-1}"});
    for(const weight of [400,500,600,700])await page.addStyleTag({content:`@font-face{font-family:Inter;src:url(data:font/woff2;base64,${(await readFile(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`)).toString("base64")});font-weight:${weight}}`});
    await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith("js"))!.text});
    const footer=renderToStaticMarkup(await Footer({locale}));
    const props={locale,plans,categories,footer,courseTitles:categories.flatMap(c=>[1,2].map(n=>({category:c.id,title:`${c.labels[locale as 'en-GB']} ${n}`})))};
    await page.evaluate(p=>(window as any).mount(p),props);
    assert.equal(await page.locator(".pricing-card-price strong").first().textContent(), "US$99.00");
    assert.equal((await page.locator(".pricing-card-price").allTextContents()).some(text=>text.includes("USD")),false);
    for(const width of [1440,390,320]){
      await page.setViewportSize({width,height:1000});
      const layout=await page.locator('.pricing-comparison').evaluate(e=>({left:e.getBoundingClientRect().left,width:e.getBoundingClientRect().width,gap:getComputedStyle(e).gap}));
      if(width===1440){assert.equal(layout.left,128);assert.equal(layout.width,1184);assert.equal(layout.gap,"32px");}
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('.portal-footer-social img')).every(image=>(image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth>0));
      assert.deepEqual(await page.locator('.portal-footer-social img').evaluateAll(images=>images.map(image=>({width:image.getBoundingClientRect().width,height:image.getBoundingClientRect().height}))),Array(3).fill({width:40,height:40}));
      const button=page.locator('.pricing-design-card--category .purchase-actions button');
      assert.equal(await button.evaluate(e=>getComputedStyle(e).color),"rgb(21, 93, 252)");
      assert.equal(await page.locator('.pricing-card-price del').textContent(),"US$117.00");
      await page.screenshot({path:`test-results/subscription-design/${locale}-${width}.png`,fullPage:true});
      const everything = page.locator('.pricing-design-card--everything'), category = page.locator('.pricing-design-card--category');
      const assertSelected = async (scope: "everything" | "category") => {
        assert.equal(await page.locator('.pricing-design-card[data-selected="true"]').count(), 1);
        for (const [card, selected] of [[everything, scope === "everything"], [category, scope === "category"]] as const) {
          assert.equal(await card.evaluate(e => getComputedStyle(e).borderTopColor), selected ? "rgb(36, 107, 253)" : "rgb(229, 231, 235)");
        }
      };
      await assertSelected("everything");
      const cardBox = () => category.evaluate(e => { const r = e.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; });
      const before = await cardBox();
      await category.locator('.pricing-category-switch button').last().click();
      await assertSelected("category");
      assert.deepEqual(await cardBox(), before, "switching the border must not shift the card");
      await page.getByRole("button", { name: getMessages(locale as "en-GB" | "zh-CN").pricingDesign.year, exact: true }).click();
      await assertSelected("category");
      await page.screenshot({path:`test-results/subscription-design/${locale}-${width}-category-selected.png`,fullPage:true});
      await everything.locator('h2').click();
      await assertSelected("everything");
      await category.locator('.pricing-category-switch button').first().focus();
      await assertSelected("category");
      await everything.locator('.pricing-category-switch button').first().focus();
      await assertSelected("everything");
      await page.getByRole("button", { name: getMessages(locale as "en-GB" | "zh-CN").pricingDesign.sixMonths, exact: true }).click();
    }
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:1000});await page.evaluate(p=>(window as any).mount({...p,account:true}),props);
      const box=await page.locator('.portal-footer').boundingBox();assert.equal(box?.x,0);assert.equal(box?.width,width);
      assert.equal(await page.locator('.portal-footer').evaluate(e=>getComputedStyle(e).backgroundColor),"rgb(21, 93, 252)");
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:`test-results/subscription-design/${locale}-account-${width}.png`,fullPage:true});
    }
    await page.close();
  }}finally{await browser.close();delete (globalThis as any).footerContent;}
});

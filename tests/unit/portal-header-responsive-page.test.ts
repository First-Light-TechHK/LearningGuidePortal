import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";

test("shared Header keeps mobile navigation compact without overflow in both locales and sessions", async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PortalHeader} from './components/portal/PortalHeader';const root=createRoot(document.getElementById('root'));window.mount=p=>{window.headerSignedIn=p.signedIn;flushSync(()=>root.render(<main className={p.auth?'portal-page portal-auth-entry-page':'portal-page'}><PortalHeader key={p.locale+':'+p.signedIn} {...p} active="courses" displayName="Guide"/></main>))};` },
    bundle:true, write:false, outfile:"header.js", platform:"browser", jsx:"automatic", loader:{".css":"local-css"}, define:{"process.env.NODE_ENV":'"production"'},
    plugins:[{name:"next",setup(builder){
      builder.onResolve({filter:/^next\//},args=>({path:args.path,namespace:"next"}));
      builder.onLoad({filter:/.*/,namespace:"next"},args=>({loader:"tsx",resolveDir:process.cwd(),contents:args.path==="next/navigation" ? "const router={refresh(){}};export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search)" : "import React from 'react';export default function Component({prefetch,priority,...props}){return props.src?<img {...props}/>:<a {...props}/>}"}));
    }}],
  });
  const browser=await chromium.launch();
  await mkdir("test-results/portal-header",{recursive:true});
  try {
    for(const locale of ["en-GB","zh-CN"]) for(const signedIn of [false,true]) {
      const page=await browser.newPage();
      await page.route("http://header.test/**",async route=>{
        if(route.request().url().endsWith("/portal/figma-logo.svg")) return route.fulfill({contentType:"image/svg+xml",body:await readFile("public/portal/figma-logo.svg")});
        if(route.request().url().includes("/api/auth/me")) {
          const signed=await page.evaluate(()=>Boolean((window as unknown as {headerSignedIn:boolean}).headerSignedIn));
          return route.fulfill({json:{ok:true,user:signed?{id:"user",nickname:"Guide"}:null}});
        }
        return route.fulfill({contentType:"text/html",body:'<!doctype html><div id="root"></div>'});
      });
      await page.goto(`http://header.test/${locale}/portal/courses?lessonId=one`);
      for(const file of ["app/styles.css","app/portal-design.css"]) await page.addStyleTag({content:await readFile(file,"utf8")});
      await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith("css"))!.text});
      for(const weight of [400,500,600,700]) {
        const font=(await readFile(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`)).toString("base64");
        await page.addStyleTag({content:`@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font});font-weight:${weight}}`});
      }
      await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith("js"))!.text});
      for(const width of [320,375,390,640,700,768,900,901,1024,1440]) {
        await page.setViewportSize({width,height:844});
        await page.evaluate(props=>(window as unknown as {mount:(props:unknown)=>void}).mount(props),{locale,signedIn});
        await page.locator(signedIn?".account-menu-trigger":".portal-header-link").waitFor();
        const metrics=await page.locator(".portal-header").evaluate(element=>{
          const nav=element.querySelector<HTMLElement>(".portal-nav")!,links=Array.from(nav.querySelectorAll("a"));
          const headerBox=element.getBoundingClientRect(),navBox=nav.getBoundingClientRect();
          return {height:headerBox.height,scroll:document.documentElement.scrollWidth,width:innerWidth,navScroll:nav.scrollWidth,navClient:nav.clientWidth,navHeight:navBox.height,
            linksFit:links.every(link=>{const box=link.getBoundingClientRect();return box.left>=navBox.left && box.right<=navBox.right && box.bottom<=headerBox.bottom}),underline:getComputedStyle(links[0],"::after").bottom,
            brand:element.querySelector(".portal-brand")!.getBoundingClientRect().right,actions:element.querySelector(".portal-header-actions")!.getBoundingClientRect().left};
        });
        assert.ok(metrics.scroll<=metrics.width,`${locale}/${signedIn}/${width}: no page overflow`);
        assert.ok(metrics.brand<=metrics.actions,`${locale}/${signedIn}/${width}: brand and actions do not overlap`);
        assert.ok(metrics.linksFit,"all navigation links remain inside the Header");
        if(width<=900) {assert.ok(metrics.height<=102);assert.equal(metrics.navHeight,44);assert.ok(metrics.navScroll<=metrics.navClient);assert.equal(metrics.underline,"0px");}
        const language=await page.locator(".portal-language").getAttribute("href");
        assert.ok(language?.includes("lessonId=one"),"language switch retains current query");
        if([320,390,768,1440].includes(width)) await page.screenshot({path:`test-results/portal-header/${locale}-${signedIn?"account":"visitor"}-${width}.png`});
      }
      await page.setViewportSize({width:390,height:844});
      await page.evaluate(props=>(window as unknown as {mount:(props:unknown)=>void}).mount(props),{locale,signedIn,auth:true});
      assert.ok(await page.locator(".portal-header").evaluate(element=>element.getBoundingClientRect().height)<=102,"auth-specific styles do not enlarge the mobile Header");
      if(signedIn) {await page.locator(".account-menu-trigger").click();await page.getByRole("menu").waitFor();await page.keyboard.press("Escape");}
      await page.close();
    }
  } finally { await browser.close(); }
});

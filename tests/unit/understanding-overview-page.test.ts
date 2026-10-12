import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getMessages } from "../../lib/i18n/messages";
test("Understanding overview renders course navigation, lesson accordions and reused tests in both locales", async()=>{
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {UnderstandingOverview} from './components/portal/UnderstandingOverview';import {sampleUnderstandingOverview} from './services/understandingOverview';window.mount=locale=>createRoot(document.getElementById('root')).render(<UnderstandingOverview locale={locale} courseId="course" courseTitle="The Art of Seeing" category="Art" backHref={'/'+locale+'/account/learn/course?lessonId=original'} data={sampleUnderstandingOverview(locale)}/>);`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,outfile:"overview.js",platform:"browser",external:["/portal/*"],jsx:"automatic",loader:{".css":"local-css"},define:{"process.env.NODE_ENV":'"production"'},plugins:[{name:"next",setup(b){b.onResolve({filter:/^next\/(image|link)$/},args=>({path:args.path,namespace:"mock"}));b.onLoad({filter:/.*/,namespace:"mock"},args=>({contents:args.path.endsWith("image")?"import React from 'react';export default function Image(props){return <img {...props}/>}":"import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>}",loader:"tsx",resolveDir:process.cwd()}));}}]});
  const browser=await chromium.launch({channel:"msedge"});await mkdir("test-results/understanding",{recursive:true});
  try {for(const locale of ["en-GB","zh-CN"] as const){
    const copy=getMessages(locale), labels=copy.understandingOverview;
    const page=await browser.newPage({viewport:{width:1440,height:1600}});
    await page.route("http://understanding.test/**",async route=>{const url=new URL(route.request().url());return url.pathname.startsWith("/portal/")?route.fulfill({body:await readFile(path.join("public",url.pathname)),contentType:"image/svg+xml"}):route.fulfill({contentType:"text/html",body:'<div style="height:68px;background:white"></div><div id="root"></div>'});});
    await page.goto("http://understanding.test/");await page.addStyleTag({content:"body{margin:0}*{box-sizing:border-box}"});await page.addStyleTag({content:bundle.outputFiles.find(f=>f.path.endsWith("css"))!.text});
    for(const weight of [400,500,600,700]){const font=(await readFile(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`)).toString("base64");await page.addStyleTag({content:`@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font});font-weight:${weight}}`});}
    await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith("js"))!.text});await page.evaluate(locale=>(window as unknown as {mount:(locale:string)=>void}).mount(locale),locale);
    await page.getByRole("heading",{name:labels.title,exact:true}).waitFor();assert.equal(await page.getByRole("progressbar").getAttribute("aria-valuenow"),"2");
    assert.equal(await page.getByRole("link",{name:`← ${labels.back}`}).getAttribute("href"),`/${locale}/account/learn/course?lessonId=original`);
    assert.equal(await page.getByRole("button",{name:copy.lessonCompleted.comingSoon,exact:true}).isDisabled(),true);
    const accordion=page.locator('button[aria-expanded]');assert.equal(await accordion.count(),2);
    const arrow=accordion.first().locator('[aria-hidden="true"]');
    const arrowStyle=()=>arrow.evaluate(e=>{const s=getComputedStyle(e);return {text:e.textContent,weight:s.fontWeight,size:s.fontSize,color:s.color,width:e.getBoundingClientRect().width,transform:s.transform};});
    assert.deepEqual(await arrowStyle(),{text:"⌃",weight:"700",size:"18px",color:"rgb(23, 104, 242)",width:15,transform:"none"});
    await page.screenshot({path:`test-results/understanding/${locale}-desktop.png`,fullPage:true});
    await accordion.first().click();assert.equal(await page.getByRole("button",{name:labels.viewResult,exact:true}).count(),0);assert.equal((await arrowStyle()).transform,"matrix(-1, 0, 0, -1, 0, 0)");await page.screenshot({path:`test-results/understanding/${locale}-collapsed.png`,fullPage:true});await accordion.first().click();assert.equal((await arrowStyle()).transform,"none");
    await page.getByRole("button",{name:labels.viewResult,exact:true}).first().click();await page.getByRole("dialog").getByRole("heading",{name:copy.knowledgeTest.result,exact:true}).waitFor();await page.keyboard.press("Escape");
    await page.getByRole("button",{name:labels.viewResult,exact:true}).nth(1).click();await page.getByRole("dialog").getByRole("heading",{name:copy.knowledgeTest.result,exact:true}).waitFor();await page.getByRole("button",{name:copy.knowledgeTest.done,exact:true}).click();assert.equal(await page.getByRole("dialog").count(),0);
    await page.getByRole("button",{name:labels.continue,exact:true}).click();await page.getByRole("dialog").getByRole("textbox").waitFor();await page.keyboard.press("Escape");
    await page.getByRole("button",{name:labels.start,exact:true}).click();await page.getByRole("dialog").getByRole("heading",{name:copy.applicationTest.title,exact:true}).waitFor();await page.keyboard.press("Escape");
    await page.setViewportSize({width:390,height:844});assert.equal((await arrowStyle()).width,15);await page.screenshot({path:`test-results/understanding/${locale}-mobile.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.close();
  }}finally{await browser.close();}
});

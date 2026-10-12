import assert from "node:assert/strict";
import { test } from "node:test";
import { overviewDesignSample } from "../../services/overviewDesignSample";
import type { ProductCourse } from "../../services/productStore";
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

test("Overview Figma samples preserve display values without changing courses",()=>{
  const courses=[{id:"real",status:"published",sections:[{lessons:[{id:"actual-lesson"}]}]}] as ProductCourse[];
  const before=structuredClone(courses), sample=overviewDesignSample(courses);
  assert.deepEqual(sample.courses.map(item=>item.progress),[46,100,10]);
  assert.deepEqual(sample.courses.map(item=>item.lessonCount),[12,10,8]);
  assert.equal(sample.courses[0].courseId,"real");assert.equal(sample.courses[0].lessonId,"actual-lesson");
  assert.equal(sample.courses[1].courseId,null);assert.deepEqual(courses,before);
});

test("Overview matches horizontal Figma cards in both locales and adapts to mobile",async()=>{
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OverviewDesign} from './components/portal/OverviewDesign';import {AccountNav} from './components/portal/AccountNav';import {getMessages} from './lib/i18n/messages';import styles from './components/portal/overview-design.module.css';const root=createRoot(document.getElementById('root'));window.mount=props=>root.render(<main className={'portal-page portal-account-page '+styles.page}><header className='portal-header' style={{height:68}}>Learning Guide</header><AccountNav locale={props.locale} copy={getMessages(props.locale).account}/><OverviewDesign {...props}/></main>);`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,outfile:"overview.js",platform:"browser",jsx:"automatic",loader:{".css":"local-css"},define:{"process.env.NODE_ENV":'"production"'},plugins:[{name:"next",setup(b){b.onResolve({filter:/^next\/(image|link|navigation)$/},args=>({path:args.path,namespace:"next"}));b.onLoad({filter:/.*/,namespace:"next"},args=>({resolveDir:process.cwd(),loader:"tsx",contents:args.path==="next/navigation"?"export function usePathname(){return location.pathname}":args.path==="next/link"?"import React from 'react';export default function Link({prefetch,...p}){return <a {...p}/>}":"import React from 'react';export default function Image(p){return <img {...p}/>}"}));}}]});
  const browser=await chromium.launch({channel:"msedge"});await mkdir("test-results/overview-v1",{recursive:true});
  try {for(const locale of ["en-GB","zh-CN"]){
    const page=await browser.newPage({viewport:{width:1440,height:1298}});
    await page.route("http://overview.test/**",async route=>{const url=new URL(route.request().url());return url.pathname.startsWith("/portal/")?route.fulfill({body:await readFile(path.join("public",url.pathname)),contentType:"image/png"}):route.fulfill({body:'<div id="root"></div>',contentType:"text/html"});});
    await page.goto(`http://overview.test/${locale}/account/my-learning`);
    for(const file of ["app/styles.css","app/portal-design.css"])await page.addStyleTag({content:await readFile(file,"utf8")});
    await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith("css"))!.text});
    for(const weight of [400,500,600])await page.addStyleTag({content:`@font-face{font-family:Inter;font-weight:${weight};src:url(data:font/woff2;base64,${(await readFile(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`)).toString("base64")})}`});
    await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith("js"))!.text});
    await page.evaluate(props=>(window as unknown as {mount:(p:unknown)=>void}).mount(props),{locale,sample:overviewDesignSample([])});
    const cards=page.locator("[data-overview-course]");await cards.first().waitFor();assert.equal(await cards.count(),3);
    const box=(await cards.first().boundingBox())!;assert.deepEqual({x:box.x,y:box.y,width:box.width,height:box.height},{x:387,y:294,width:946,height:178});
    assert.equal((await page.locator('.account-nav').boundingBox())!.x,40,"sidebar uses the same centred account frame as Personal Settings");
    assert.deepEqual(await page.getByRole("progressbar").evaluateAll(nodes=>nodes.map(node=>node.getAttribute("aria-valuenow"))),["46","100","10"]);
    for(const image of await cards.locator("img").all()){await image.evaluate(image=>(image as HTMLImageElement).decode());const parent=(await image.locator("..").boundingBox())!;assert.equal(parent.width,280);assert.equal(parent.height,130);assert.equal(await image.evaluate(image=>(image as HTMLImageElement).naturalWidth>0),true);}
    assert.equal(await cards.last().getByRole("link").getAttribute("href"),`/${locale}/pricing`);
    await page.screenshot({path:`test-results/overview-v1/${locale}-desktop.png`,fullPage:true});
    for(const width of [2560,1920,1440,1200,768,390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(width>1300){assert.equal((await page.locator(".account-nav").boundingBox())!.x,Math.max(40,(width-1440)/2),"sidebar and content share the centred Personal Settings frame");const cardBox=(await cards.first().boundingBox())!;assert.equal(cardBox.width,946);assert.ok(Math.abs((cardBox.x-280)-(width-cardBox.x-cardBox.width))<1,"wide-screen content is centred beside the sidebar");}if(width===390)await page.screenshot({path:`test-results/overview-v1/${locale}-mobile.png`,fullPage:true});}
    await page.close();
  }}finally{await browser.close();}
});

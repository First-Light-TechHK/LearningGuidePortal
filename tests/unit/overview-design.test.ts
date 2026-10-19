import assert from "node:assert/strict";
import { test } from "node:test";
import type { OverviewDisplay } from "../../contracts/overview-display";
import { getMessages } from "../../lib/i18n/messages";
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const displayFixture = (name:string,locale:string): OverviewDisplay => ({name,courses:[33,100,67].map((progress,index)=>({
  id:`record-${index}`,courseId:`actual-${index}`,title:["Actual video course","Completed course","Expired course"][index],category:"Science",
  cover:["/portal/overview-v1/art.png","/portal/overview-v1/history.png","/portal/overview-v1/nature.png"][index],
  lessonCount:3,currentLesson:index+1,lessonId:`lesson-${index}`,contentId:`video-${index}`,progress,mode:"video",
  action:index===0?"resume":index===1?"review":"plans",href:index===2?`/${locale}/subscription?courseId=actual-2`:`/${locale}/account/learn/actual-${index}?lessonId=lesson-${index}&contentId=video-${index}&viewMode=video`
}))});

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
    const name=locale === "en-GB" ? "Alice" : "李明";
    await page.evaluate(props=>(window as unknown as {mount:(p:unknown)=>void}).mount(props),{locale,data:displayFixture(name,locale)});
    const cards=page.locator("[data-overview-course]");await cards.first().waitFor();assert.equal(await cards.count(),3);
    assert.ok((await page.locator("#overview-heading").textContent())?.includes(name));
    assert.equal(await page.getByText(/Macai/).count(),0);
    const box=(await cards.first().boundingBox())!;assert.deepEqual({x:box.x,y:box.y,width:box.width,height:box.height},{x:387,y:294,width:946,height:178});
    assert.equal((await page.locator('.account-nav').boundingBox())!.x,40,"sidebar uses the same centred account frame as Personal Settings");
    assert.deepEqual(await page.getByRole("progressbar").evaluateAll(nodes=>nodes.map(node=>node.getAttribute("aria-valuenow"))),["33","100","67"]);
    for(const image of await cards.locator("img").all()){await image.evaluate(image=>(image as HTMLImageElement).decode());const parent=(await image.locator("..").boundingBox())!;assert.equal(parent.width,280);assert.equal(parent.height,130);assert.equal(await image.evaluate(image=>(image as HTMLImageElement).naturalWidth>0),true);}
    assert.equal(await cards.last().getByRole("link").getAttribute("href"),`/${locale}/subscription?courseId=actual-2`);
    assert.ok((await cards.first().getByRole("link").getAttribute("href"))?.includes("contentId=video-0"));
    await page.screenshot({path:`test-results/overview-v1/${locale}-desktop.png`,fullPage:true});
    for(const width of [2560,1920,1440,1200,768,390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(width>1300){assert.equal((await page.locator(".account-nav").boundingBox())!.x,Math.max(40,(width-1440)/2),"sidebar and content share the centred Personal Settings frame");const cardBox=(await cards.first().boundingBox())!;assert.equal(cardBox.width,946);assert.ok(Math.abs((cardBox.x-280)-(width-cardBox.x-cardBox.width))<1,"wide-screen content is centred beside the sidebar");}if(width===390)await page.screenshot({path:`test-results/overview-v1/${locale}-mobile.png`,fullPage:true});}
    const preview=displayFixture(name,locale);preview.courses=[{...preview.courses[0],title:"Chinese Humanities preview",lessonCount:4,progress:0,currentLesson:1,action:"preview",href:`/${locale}/portal/courses/chinese/public-lesson?viewMode=video&contentId=preview-point`}];
    await page.evaluate(props=>(window as unknown as {mount:(p:unknown)=>void}).mount(props),{locale,data:preview});
    const previewMessages=getMessages(locale as "en-GB"|"zh-CN");
    await cards.first().getByText(previewMessages.overviewDesign.previewing,{exact:false}).waitFor();
    assert.equal(await page.getByRole("progressbar").getAttribute("aria-valuenow"),"0");
    assert.equal(await cards.first().getByText(previewMessages.learning.completed,{exact:false}).count(),0);
    assert.equal(await cards.count(),1);assert.ok((await cards.first().textContent())?.includes(previewMessages.overviewV1.lessons.replace("{count}","4")));
    assert.ok((await cards.first().getByRole("link").getAttribute("href"))?.includes("public-lesson"));
    await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:`test-results/overview-v1/${locale}-partial-preview.png`,fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:`test-results/overview-v1/${locale}-partial-preview-mobile.png`,fullPage:true});
    const unavailable=displayFixture(name,locale);unavailable.courses=[{...unavailable.courses[0],progress:null,action:"detail",href:`/${locale}/portal/courses/actual-0`}];
    await page.evaluate(props=>(window as unknown as {mount:(p:unknown)=>void}).mount(props),{locale,data:unavailable});
    await page.getByRole("status").waitFor();assert.equal(await page.getByRole("progressbar").count(),0);
    assert.equal(await cards.first().getByRole("link").getAttribute("href"),`/${locale}/portal/courses/actual-0`);
    await page.evaluate(props=>(window as unknown as {mount:(p:unknown)=>void}).mount(props),{locale,data:{name,courses:[]}});
    await page.getByText(getMessages(locale as "en-GB"|"zh-CN").learningOverview.noLearning,{exact:true}).waitFor();
    assert.equal(await cards.count(),0);
    await page.close();
  }}finally{await browser.close();}
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

test("video pages gate unlock and completion, reset on content changes, save explicitly and retry failures", async () => {
  const bundle = await build({
    stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PreviewLessonView} from './components/portal/PreviewLessonView';import {LearningRoom} from './components/portal/LearningRoom';import {getMessages} from './lib/i18n/messages';const root=createRoot(document.getElementById('root'));window.mount=props=>flushSync(()=>root.render(props.room ? <LearningRoom key={props.key} {...props} copy={getMessages(props.locale).learning}/> : <PreviewLessonView key={props.key} {...props}/>));`,resolveDir:process.cwd(),loader:"tsx"},
    bundle:true,write:false,outfile:"completion.js",platform:"browser",jsx:"automatic",external:["/portal/*"],loader:{".css":"local-css"},define:{"process.env.NODE_ENV":'"production"'},
    plugins:[{name:"next",setup(builder){
      builder.onResolve({filter:/Course(Model|Pdf)Preview$/},args=>({path:args.path,namespace:"unrelated"}));
      builder.onLoad({filter:/.*/,namespace:"unrelated"},()=>({contents:"export const CourseModelPreview=()=>null;export const CoursePdfPreview=()=>null;"}));
      builder.onResolve({filter:/^next\/(image|link|navigation|dynamic)$/},args=>({path:args.path,namespace:"next"}));
      builder.onLoad({filter:/.*/,namespace:"next"},args=>({resolveDir:process.cwd(),loader:"tsx",contents:args.path === "next/navigation" ? "export function useRouter(){return {refresh(){window.refreshed=true},push(href){window.navigated=href}}}" : args.path === "next/dynamic" ? "export default function dynamic(){return ()=>null}" : args.path === "next/link" ? "import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>;}" : "import React from 'react';export default function Image({unoptimized,...props}){return <img {...props}/>;}"}));
    }}],
  });
  const browser = await chromium.launch({channel:"msedge"});
  await mkdir("test-results/video-completion",{recursive:true});
  const lesson = {id:"lesson",title:"Looking closely",body:"Public lesson.",durationMinutes:2,contents:[{id:"video",title:"Observe composition",type:"video",mode:"lecture",url:"/video-fixture.mp4",nodes:[]},{id:"video-2",title:"Second video",type:"video",mode:"lecture",url:"/video-other.mp4",nodes:[]},{id:"text",title:"Read visual cues",type:"text",mode:"lecture",html:"<p>Text lesson.</p>",nodes:[]}]};
  try {
    for (const locale of ["en-GB","zh-CN"]) {
      const page = await browser.newPage({viewport:{width:1440,height:1024}});
      let fail = false; const completions: unknown[] = [];
      await page.route("http://completion.test/**",async route=>{
        const url = new URL(route.request().url());
        if(url.pathname.startsWith("/api/study/")) {
          const body=route.request().postDataJSON();if(body.event === "complete")completions.push(body);
          return route.fulfill({status:body.event === "complete" && fail ? 403 : 200,contentType:"application/json",body:'{"record":{}}'});
        }
        if(url.pathname.startsWith("/portal/"))return route.fulfill({body:await readFile(path.join("public",url.pathname)),contentType:url.pathname.endsWith(".svg") ? "image/svg+xml" : "image/jpeg"});
        if(url.pathname.endsWith("mp4"))return route.fulfill({status:404,body:""});
        return route.fulfill({contentType:"text/html",body:'<div id="root"></div>'});
      });
      await page.goto(`http://completion.test/${locale}/portal/courses/course/public-lesson`);
      for(const file of ["app/styles.css","app/portal-design.css"])await page.addStyleTag({content:await readFile(file,"utf8")});
      await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith("css"))!.text});
      for(const weight of [400,500,600,700]){const font=(await readFile(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`)).toString("base64");await page.addStyleTag({content:`@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font});font-weight:${weight}}`});}
      await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith("js"))!.text});
      const mount=(key:string,entitled=true,room=false,initialCompleted=false,nextHref:string|null=null)=>page.evaluate(props=>(window as unknown as {mount:(props:unknown)=>void}).mount(props),{locale,key,room,lesson,initialCompleted,courseId:"course",courseTitle:"The Art of Seeing",category:"Art",description:"Observe with attention, curiosity and confidence.",poster:"/portal/course-study.jpg",outline:[{id:"lesson",number:"01",title:lesson.title,href:"/lesson"}],nextHref,entitled,trialGate:entitled ? undefined : {pricingHref:"/pricing",recommendations:[],videoLimitSeconds:60}});
      const progress=async (time:number,duration=100)=>{await page.locator("video").waitFor();await page.locator("video").evaluate((element,{time,duration})=>{Object.defineProperty(element,"duration",{configurable:true,value:duration});Object.defineProperty(element,"currentTime",{configurable:true,writable:true,value:time});element.dispatchEvent(new Event("timeupdate",{bubbles:true}));},{time,duration});};
      const bar=page.getByRole("region",{name:locale === "zh-CN" ? "课时完成提示" : "Lesson completion"});
      await mount("entitled");await progress(97.99);assert.equal(await bar.count(),0);
      assert.equal(await page.locator('a[href*="/understanding?"]').getAttribute("href"),`/${locale}/portal/courses/course/understanding?lessonId=lesson&from=preview`);
      assert.equal(await page.locator('a[href="/en-GB/pricing?courseId=course"],a[href="/zh-CN/pricing?courseId=course"]').count(),0);
      await page.evaluate(`(()=>{let fullscreen=document.body;Object.defineProperty(document,"fullscreenElement",{configurable:true,get:()=>fullscreen});document.exitFullscreen=async()=>{fullscreen=null;window.fullscreenExited=true;};})()`);
      await progress(98);await bar.waitFor();await page.waitForFunction(()=> (window as unknown as {fullscreenExited:boolean}).fullscreenExited===true);assert.equal(completions.length,0,"threshold must not save completion automatically");
      const box=(await bar.boundingBox())!;assert.equal(box.height,76);
      await page.screenshot({path:`test-results/video-completion/${locale}-98.png`,fullPage:true});
      await bar.getByRole("button",{name:locale === "zh-CN" ? "继续观看" : "Keep watching"}).click();assert.equal(await bar.count(),0);assert.equal(completions.length,0);
      await progress(100); assert.equal(await page.getByRole("dialog").count(),0,"seeking to the end must not complete a lesson");
      await page.locator("video").evaluate(element=>{element.dispatchEvent(new Event("ended"));element.dispatchEvent(new Event("ended"));});
      await page.getByRole("dialog").waitFor(); assert.equal(completions.length,1,"ended after Keep watching saves once");
      await page.getByRole("dialog").getByRole("button").last().click();
      completions.length=0;
      await mount("retry",true,false,false,`/${locale}/account/learn/course?lessonId=next`);await progress(98);await bar.waitFor();fail=true;
      assert.equal(await page.locator(`a[href="/${locale}/account/learn/course?lessonId=next"]`).count(),0,"video playback omits the standalone continuation link");
      const complete=bar.getByRole("button",{name:locale === "zh-CN" ? "完成课时" : "Complete lesson",exact:true});
      await complete.click();await bar.getByRole("alert").waitFor();assert.equal(await complete.isEnabled(),true);
      fail=false;await complete.click();
      await page.getByRole("dialog").waitFor();
      await page.screenshot({path:`test-results/video-completion/${locale}-completed-dialog.png`,fullPage:true});
      assert.equal(await page.getByRole("dialog").locator("img").evaluateAll(images=>images.every(image=>(image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth>0)),true);
      await page.getByRole("dialog").getByRole("button").nth(1).click(); await page.getByRole("dialog").getByRole("textbox").waitFor(); await page.getByRole("dialog").getByRole("button").first().click();
      await page.setViewportSize({width:390,height:844}); await page.screenshot({path:`test-results/video-completion/${locale}-completed-mobile.png`,fullPage:true});
      assert.equal(await page.getByRole("dialog").evaluate(element=>element.scrollWidth>element.clientWidth || element.getBoundingClientRect().right>innerWidth),false);
      await page.getByRole("dialog").getByRole("button").last().click();
      await page.setViewportSize({width:1440,height:1024});
      assert.equal(await page.evaluate(()=>(window as unknown as {navigated:string}).navigated),`/${locale}/account/learn/course?lessonId=next`);
      assert.equal(completions.length,2);assert.equal((completions[0] as {clientEventId:string}).clientEventId,(completions[1] as {clientEventId:string}).clientEventId);
      await mount("ended-retry"); await progress(98); await bar.waitFor();
      await bar.getByRole("button").first().click(); fail=true;
      await page.locator("video").evaluate(element=>element.dispatchEvent(new Event("ended")));
      await page.getByRole("alert").waitFor(); assert.equal(await page.getByRole("dialog").count(),0);
      fail=false; await page.getByRole("alert").getByRole("button").click(); await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape"); assert.equal(await page.getByRole("dialog").count(),0);
      await mount("switch");await progress(98);await bar.waitFor();
      await page.getByRole("button",{name:"1.2 Second video",exact:true}).click();assert.equal(await bar.count(),0);
      await progress(98);await bar.waitFor();await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:`test-results/video-completion/${locale}-mobile.png`,fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await mount("preview",false);await page.locator('a[href="/pricing"]').waitFor();await progress(58,59);assert.equal(await bar.count(),0);
      await page.locator("video").evaluate(element=>element.dispatchEvent(new Event("ended"))); assert.equal(await page.getByRole("dialog").count(),0,"unentitled previews never show completion dialog");
      const savedCount=completions.length;
      await mount("completed",true,false,true);await progress(36.749,37.5);assert.equal(await bar.count(),0);await progress(36.75,37.5);await bar.waitFor();
      await bar.getByRole("button").last().click();await page.getByRole("dialog").waitFor();assert.equal(completions.length,savedCount,"rewatching a completed lesson opens the result without a duplicate save");await page.keyboard.press("Escape");
      await page.setViewportSize({width:1440,height:1024}); await mount("room",true,true,false,`/${locale}/account/learn/course?lessonId=next`);await progress(97.99);assert.equal(await bar.count(),0);await progress(98);await bar.waitFor();
      await bar.getByRole("button",{name:locale === "zh-CN" ? "完成课时" : "Complete lesson",exact:true}).click();
      await page.getByRole("dialog").waitFor();
      await page.screenshot({path:`test-results/video-completion/${locale}-completed-dialog.png`,fullPage:true});
      assert.equal(await page.getByRole("dialog").locator("img").evaluateAll(images=>images.every(image=>(image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth>0)),true);
      await page.getByRole("dialog").getByRole("button").nth(1).click(); await page.getByRole("dialog").getByRole("textbox").waitFor(); await page.getByRole("dialog").getByRole("button").first().click();
      await page.setViewportSize({width:390,height:844}); await page.screenshot({path:`test-results/video-completion/${locale}-completed-mobile.png`,fullPage:true});
      assert.equal(await page.getByRole("dialog").evaluate(element=>element.scrollWidth>element.clientWidth || element.getBoundingClientRect().right>innerWidth),false);
      await page.getByRole("dialog").getByRole("button").last().click();
      await page.setViewportSize({width:1440,height:1024});
      assert.equal(await page.evaluate(()=>(window as unknown as {navigated:string}).navigated),`/${locale}/account/learn/course?lessonId=next`);
      await mount("last"); await progress(98); await bar.waitFor(); await bar.getByRole("button").last().click(); await page.getByRole("dialog").waitFor(); await page.getByRole("dialog").getByRole("button").last().click(); assert.equal(await page.evaluate(()=>(window as unknown as {navigated:string}).navigated),`/${locale}/account/my-learning`);
      await page.close();
    }
  } finally {await browser.close();}
});

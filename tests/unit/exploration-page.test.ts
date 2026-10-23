import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile,mkdir} from "node:fs/promises";
import path from "node:path";
import {build} from "esbuild";
import {chromium} from "playwright";
import {getMessages} from "../../lib/i18n/messages";

test("Explore Further opens in place, scrolls reading and reuses working image/video/model viewers without resuming the lesson",async()=>{
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PreviewLessonView} from './components/portal/PreviewLessonView';import {LearningRoom} from './components/portal/LearningRoom';import {getMessages} from './lib/i18n/messages';const root=createRoot(document.getElementById('root'));window.mount=p=>flushSync(()=>root.render(p.room?<LearningRoom key={p.key} {...p} copy={getMessages(p.locale).learning}/>:<PreviewLessonView key={p.key} {...p}/>));`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,outfile:"exploration.js",platform:"browser",external:["/portal/*"],jsx:"automatic",loader:{".css":"local-css"},define:{"process.env.NODE_ENV":'"production"'},plugins:[{name:"next",setup(builder){
    builder.onResolve({filter:/^next\/(image|dynamic|link|navigation)$/},args=>({path:args.path,namespace:"next"}));
    builder.onLoad({filter:/.*/,namespace:"next"},args=>({resolveDir:process.cwd(),loader:"tsx",contents:args.path==="next/dynamic"?"import React from 'react';export default function dynamic(factory){const Component=React.lazy(()=>factory().then(defaultExport=>({default:defaultExport})));return props=><React.Suspense fallback={null}><Component {...props}/></React.Suspense>}":args.path==="next/navigation"?"export function useRouter(){return {refresh(){},push(href){window.navigation=href}}}":args.path==="next/link"?"import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>}":"import React from 'react';export default function Image({fill,unoptimized,...props}){return <img {...props} style={{...(fill?{position:'absolute',inset:0,width:'100%',height:'100%'}:{}),...props.style}}/>}"}));
    builder.onResolve({filter:/CoursePdfPreview$/},args=>({path:args.path,namespace:"pdf"}));builder.onLoad({filter:/.*/,namespace:"pdf"},()=>({contents:"export const CoursePdfPreview=()=>null"}));
  }}]});
  const browser=await chromium.launch({args:["--use-angle=swiftshader","--enable-unsafe-swiftshader"]});await mkdir("test-results/exploration",{recursive:true});
  try{for(const locale of ["en-GB","zh-CN"] as const){
    const copy=getMessages(locale),labels=copy.exploration;
    const page=await browser.newPage({viewport:{width:1440,height:1024}});
    await page.route("http://exploration.test/**",async route=>{const pathname=new URL(route.request().url()).pathname;
      if(pathname==="/lesson.webm")return route.fulfill({body:await readFile("tests/fixtures/media/flower.webm"),contentType:"video/webm"});
      if(pathname.startsWith("/portal/"))return route.fulfill({body:await readFile(path.join("public",pathname)),contentType:pathname.endsWith("svg")?"image/svg+xml":pathname.endsWith("webm")?"video/webm":pathname.endsWith("obj")?"text/plain":pathname.endsWith("png")?"image/png":"image/jpeg"});
      if(pathname.startsWith("/api/"))return route.fulfill({contentType:"application/json",body:'{"record":{}}'});
      return route.fulfill({contentType:"text/html",body:'<div id="root"></div>'});
    });
    await page.goto("http://exploration.test");for(const file of ["app/styles.css","app/portal-design.css","components/portal/lesson-authoring.css"])await page.addStyleTag({content:await readFile(file,"utf8")});await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith("css"))!.text});
    for(const weight of [400,500,600,700]){const font=(await readFile(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`)).toString("base64");await page.addStyleTag({content:`@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font});font-weight:${weight}}`});}await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith("js"))!.text});
    const lesson={id:"lesson",title:"Looking closely",body:"",durationMinutes:2,contents:[{id:"video",title:"Observe",type:"video",mode:"lecture",url:"/lesson.webm",nodes:[]}]};
    const mount=(room=false,entitled=true,current="01",unlockThird=false)=>{
      const outline=[{id:"lesson",number:"01",title:"Looking closely",href:"/lesson",modes:["video"]},{id:"lesson-2",number:"02",title:"Looking again",href:"/lesson-2",modes:["text"]},{id:"lesson-3",number:"03",title:"Further observations",href:unlockThird?"/lesson-3":null,modes:["video"]}];
      return page.evaluate(p=>(window as unknown as {mount:(p:unknown)=>void}).mount(p),{key:`${locale}-${room}-${entitled}-${current}-${unlockThird}`,room,locale,courseId:"course",courseTitle:"The Art of Seeing",category:"Art",description:"Observe",lesson:current==="01"?lesson:{...lesson,id:"lesson-2",title:"Looking again",contents:[{id:"reading",title:"Reading",type:"text",mode:"lecture",html:"<p>Looking again.</p>",nodes:[]}]},outline,explorationLessons:outline.map(item=>({number:item.number,title:item.title,unlocked:Boolean(item.href)})),lessonNumber:current,poster:"/portal/course-study.jpg",initialCompleted:true,nextHref:null,entitled});
    };
    await mount();const original=page.locator("video").first();await original.evaluate(async(video:HTMLVideoElement)=>{video.loop=true;await video.play();});await original.evaluate(video=>{(window as unknown as {lessonVideo:HTMLVideoElement}).lessonVideo=video as HTMLVideoElement;});
    const explore=page.getByRole("button",{name:new RegExp(copy.previewVideoDesign.explore)});await explore.click();const dialog=page.getByRole("dialog");await dialog.waitFor();assert.equal(await original.evaluate((v:HTMLVideoElement)=>v.paused),true);
    assert.equal(await dialog.getByRole("tab",{name:labels.reading,exact:true}).getAttribute("aria-selected"),"true");assert.equal(await dialog.locator("article").count(),4);
    assert.equal(await dialog.getByRole("heading",{name:/01\s*Looking closely/}).count(),1);
    assert.deepEqual(await dialog.evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),{width:1000,height:822});
    assert.equal(await dialog.locator("article").first().getByRole("button").count(),0,"reading is display only");
    await page.screenshot({path:`test-results/exploration/${locale}-reading.png`});
    await dialog.getByRole("tab",{name:labels.reading,exact:true}).focus();await page.keyboard.press("ArrowRight");
    assert.equal(await dialog.getByRole("tab",{name:labels.exhibits,exact:true}).getAttribute("aria-selected"),"true");assert.equal(await dialog.locator("article").count(),5,"switching tabs retains the lesson filter");
    const lessonScope=dialog.getByRole("button",{name:labels.thisLesson,exact:true}),courseScope=dialog.getByRole("button",{name:labels.wholeCourse,exact:true});
    assert.equal(await lessonScope.getAttribute("aria-pressed"),"true");
    await dialog.getByRole("tab",{name:labels.reading,exact:true}).click();await dialog.getByRole("tab",{name:labels.exhibits,exact:true}).click();assert.equal(await lessonScope.getAttribute("aria-pressed"),"true");assert.equal(await dialog.locator("article").count(),5);
    await page.screenshot({path:`test-results/exploration/${locale}-lesson-exhibits.png`});
    const row=dialog.locator("[data-exhibit-id]").first();
    assert.deepEqual(await row.locator("img").first().evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,radius:getComputedStyle(e).borderRadius})),{width:56,height:56,radius:"8px"});
    await courseScope.click();assert.equal(await dialog.locator("article").count(),10);
    assert.equal(await dialog.getByRole("heading",{name:/02\s*Looking again/}).count(),1,"Whole course includes the unlocked text lesson from the video lesson");
    assert.equal(await dialog.getByRole("heading",{name:/Further observations/}).count(),0,"locked lessons have no sample payload rows");
    assert.equal(new Set(await dialog.locator('[data-exhibit-id]').evaluateAll(elements=>elements.map(e=>e.getAttribute('data-exhibit-id')))).size,10);
    const verifyLocked=async(tab:"reading"|"exhibits")=>{
      const locked=dialog.locator(`[data-exploration-locked="${tab}"]`);
      assert.equal(await locked.count(),1);
      assert.equal(await locked.getAttribute("aria-label"),tab==="reading"?labels.moreReadings:labels.moreExhibits);
      const ghost=locked.locator("[data-exploration-ghost]");
      assert.equal(await ghost.getAttribute("aria-hidden"),"true");
      assert.deepEqual(await ghost.evaluate(e=>({blur:getComputedStyle(e).filter,opacity:getComputedStyle(e).opacity,rows:e.children.length})),{blur:"blur(3px)",opacity:"0.55",rows:3});
      assert.equal(await locked.evaluate(e=>e.getBoundingClientRect().height),150);
      assert.equal(await locked.locator("button,a,[tabindex]").count(),0,"locked preview contains no action or keyboard destination");
      assert.deepEqual(await locked.locator("img").evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,filter:getComputedStyle(e.parentElement!).filter})),{width:16,height:16,filter:"none"});
      await locked.click();assert.equal(await dialog.getByRole("heading",{name:labels.title,exact:true}).count(),1);
    };
    await verifyLocked("exhibits");
    await dialog.getByRole("tab",{name:labels.reading,exact:true}).click();await verifyLocked("reading");
    assert.equal(await dialog.locator("article").count(),8);
    await page.screenshot({path:`test-results/exploration/${locale}-reading-locked.png`});
    await dialog.getByRole("tab",{name:labels.reading,exact:true}).focus();await page.keyboard.press("End");assert.equal(await courseScope.getAttribute("aria-pressed"),"true");assert.equal(await dialog.locator("article").count(),10,"keyboard switching also retains the course filter");
    await dialog.locator("img").evaluateAll(images=>Promise.all(images.map(image=>(image as HTMLImageElement).decode())));
    assert.equal(await dialog.locator("img").evaluateAll(images=>images.every(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0)),true);
    await page.screenshot({path:`test-results/exploration/${locale}-exhibits.png`});
    for(let index=0;index<3;index++){
      await dialog.locator("[data-exhibit-id]").nth(index).click();
      await dialog.getByRole("heading",{name:copy.exhibitDialog.about,exact:true}).waitFor();
      await page.waitForFunction(()=>!document.querySelector('dialog [role="group"] button')?.hasAttribute("disabled"));
      if(index===0)assert.equal(await dialog.locator('img[alt]:not([alt=""])').count(),1);
      if(index===1){await dialog.getByRole("button",{name:locale==="en-GB"?"Play":"播放",exact:true}).click();await page.waitForFunction(()=>{const v=document.querySelector("dialog video");return v instanceof HTMLVideoElement&&!v.paused&&v.currentTime>.1;});}
      if(index===2)await dialog.locator("canvas").waitFor();
      await dialog.getByRole("group").getByRole("button").nth(1).click();await page.waitForFunction(()=>document.querySelector("output")?.textContent==="125%");
      await page.keyboard.press("Escape");await dialog.getByRole("tab",{name:labels.exhibits,exact:true}).waitFor();assert.equal(await page.evaluate(()=>(window as unknown as {lessonVideo:HTMLVideoElement}).lessonVideo.paused),true);
    }
    await page.setViewportSize({width:390,height:650});await dialog.getByRole("tab",{name:labels.reading,exact:true}).click();await page.screenshot({path:`test-results/exploration/${locale}-mobile-reading.png`});assert.equal(await dialog.getByRole("tabpanel").evaluate(e=>e.scrollHeight>e.clientHeight),true);
    await dialog.getByRole("tabpanel").evaluate(e=>e.scrollTop=e.scrollHeight);assert.ok(await dialog.getByRole("tabpanel").evaluate(e=>e.scrollTop)>0);
    await verifyLocked("reading");await page.screenshot({path:`test-results/exploration/${locale}-mobile-reading-locked.png`});
    await dialog.getByRole("tab",{name:labels.exhibits,exact:true}).click();await dialog.locator("img").evaluateAll(images=>Promise.all(images.map(image=>(image as HTMLImageElement).decode())));await page.screenshot({path:`test-results/exploration/${locale}-mobile-exhibits.png`});assert.equal(await dialog.evaluate(e=>e.scrollWidth>e.clientWidth),false);
    await verifyLocked("exhibits");await page.screenshot({path:`test-results/exploration/${locale}-mobile-exhibits-locked.png`});
    await dialog.getByRole("tabpanel").evaluate(e=>e.scrollTop=100);await dialog.locator("[data-exhibit-id]").nth(1).click();await page.keyboard.press("Escape");await dialog.getByRole("tab",{name:labels.exhibits,exact:true}).waitFor();assert.ok(await dialog.getByRole("tabpanel").evaluate(e=>e.scrollTop)>=90);
    await dialog.getByRole("button",{name:labels.close,exact:true}).click();assert.equal(await dialog.count(),0);assert.equal(await original.evaluate((v:HTMLVideoElement)=>v.paused),true);
    await page.setViewportSize({width:1440,height:1024});await mount(false,true,"02");await explore.click();
    assert.equal(await dialog.locator("article").count(),4);assert.equal(await dialog.getByRole("heading",{name:/02\s*Looking again/}).count(),1);
    await courseScope.click();assert.equal(await dialog.locator("article").count(),8);
    assert.equal(await dialog.getByRole("heading",{name:/01\s*Looking closely/}).count(),1,"previous lessons are included when entering from a later lesson");
    await dialog.getByRole("tab",{name:labels.exhibits,exact:true}).click();assert.equal(await dialog.locator("article").count(),10);
    await lessonScope.click();assert.equal(await dialog.locator("article").count(),5);await page.keyboard.press("Escape");
    await mount(false,true,"02",true);await explore.click();await courseScope.click();assert.equal(await dialog.locator("article").count(),12);
    assert.equal(await dialog.locator('[data-exploration-locked]').count(),0,"fully unlocked courses have no locked upsell");
    await dialog.getByRole("tab",{name:labels.exhibits,exact:true}).click();assert.equal(await dialog.locator("article").count(),15);
    await page.screenshot({path:`test-results/exploration/${locale}-all-unlocked.png`});await page.keyboard.press("Escape");
    await mount(true);await explore.click();await dialog.getByRole("tab",{name:labels.reading,exact:true}).waitFor();await courseScope.click();assert.equal(await dialog.locator("article").count(),8,"the shared LearningRoom also aggregates its authorised Lesson metadata");await page.keyboard.press("Escape");assert.equal(await dialog.count(),0);
    await mount(false,false);assert.equal(await explore.isDisabled(),true);await page.close();
  }}finally{await browser.close();}
});

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
  const browser=await chromium.launch({channel:"msedge",args:["--use-angle=swiftshader","--enable-unsafe-swiftshader"]});await mkdir("test-results/exploration",{recursive:true});
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
    const mount=(room=false,entitled=true)=>page.evaluate(p=>(window as unknown as {mount:(p:unknown)=>void}).mount(p),{key:`${locale}-${room}-${entitled}`,room,locale,courseId:"course",courseTitle:"The Art of Seeing",category:"Art",description:"Observe",lesson,outline:[{id:"lesson",number:"01",title:"Looking closely",href:"/lesson"}],poster:"/portal/course-study.jpg",initialCompleted:true,nextHref:null,entitled});
    await mount();const original=page.locator("video").first();await original.evaluate(async(video:HTMLVideoElement)=>{video.loop=true;await video.play();});await original.evaluate(video=>{(window as unknown as {lessonVideo:HTMLVideoElement}).lessonVideo=video as HTMLVideoElement;});
    const explore=page.getByRole("button",{name:new RegExp(copy.previewVideoDesign.explore)});await explore.click();const dialog=page.getByRole("dialog");await dialog.waitFor();assert.equal(await original.evaluate((v:HTMLVideoElement)=>v.paused),true);
    assert.equal(await dialog.getByRole("tab",{name:labels.reading,exact:true}).getAttribute("aria-selected"),"true");assert.equal(await dialog.locator("article").count(),4);
    await page.screenshot({path:`test-results/exploration/${locale}-reading.png`});
    await dialog.getByRole("tab",{name:labels.reading,exact:true}).focus();await page.keyboard.press("ArrowRight");
    assert.equal(await dialog.getByRole("tab",{name:labels.exhibits,exact:true}).getAttribute("aria-selected"),"true");assert.equal(await dialog.locator("article").count(),3,"switching tabs retains the lesson filter");
    const lessonScope=dialog.getByRole("button",{name:labels.thisLesson,exact:true}),courseScope=dialog.getByRole("button",{name:labels.wholeCourse,exact:true});
    assert.equal(await lessonScope.getAttribute("aria-pressed"),"true");
    await dialog.getByRole("tab",{name:labels.reading,exact:true}).click();await dialog.getByRole("tab",{name:labels.exhibits,exact:true}).click();assert.equal(await lessonScope.getAttribute("aria-pressed"),"true");assert.equal(await dialog.locator("article").count(),3);
    await courseScope.click();assert.equal(await dialog.locator("article").count(),5);
    await dialog.getByRole("tab",{name:labels.reading,exact:true}).focus();await page.keyboard.press("End");assert.equal(await courseScope.getAttribute("aria-pressed"),"true");assert.equal(await dialog.locator("article").count(),5,"keyboard switching also retains the course filter");
    await dialog.locator("img").evaluateAll(images=>Promise.all(images.map(image=>(image as HTMLImageElement).decode())));
    assert.equal(await dialog.locator("img").evaluateAll(images=>images.every(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0)),true);
    await page.screenshot({path:`test-results/exploration/${locale}-exhibits.png`});
    for(let index=0;index<3;index++){
      await dialog.getByRole("button",{name:`${copy.videoExhibit.view} →`,exact:true}).nth(index).click();
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
    await dialog.getByRole("tab",{name:labels.exhibits,exact:true}).click();await page.screenshot({path:`test-results/exploration/${locale}-mobile-exhibits.png`});assert.equal(await dialog.evaluate(e=>e.scrollWidth>e.clientWidth),false);
    await dialog.getByRole("tabpanel").evaluate(e=>e.scrollTop=100);await dialog.getByRole("button",{name:`${copy.videoExhibit.view} →`,exact:true}).nth(1).click();await page.keyboard.press("Escape");await dialog.getByRole("tab",{name:labels.exhibits,exact:true}).waitFor();assert.ok(await dialog.getByRole("tabpanel").evaluate(e=>e.scrollTop)>=90);
    await dialog.getByRole("button",{name:labels.close,exact:true}).click();assert.equal(await dialog.count(),0);assert.equal(await original.evaluate((v:HTMLVideoElement)=>v.paused),true);
    await mount(true);await explore.click();await dialog.getByRole("tab",{name:labels.reading,exact:true}).waitFor();await page.keyboard.press("Escape");assert.equal(await dialog.count(),0);
    await mount(false,false);assert.equal(await explore.isDisabled(),true);await page.close();
  }}finally{await browser.close();}
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getMessages } from "../../lib/i18n/messages";
import { lessonMessages } from "../../messages/lesson-authoring";

test("video exhibits appear at configured times, dismiss, reopen and respect seek/trial boundaries", async () => {
  const bundle = await build({
    stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PreviewLessonView} from './components/portal/PreviewLessonView';import {LearningRoom} from './components/portal/LearningRoom';import {getMessages} from './lib/i18n/messages';const root=createRoot(document.getElementById('root'));window.mount=props=>flushSync(()=>root.render(props.room ? <LearningRoom key={props.key} {...props} copy={getMessages(props.locale).learning}/> : <PreviewLessonView key={props.key} {...props}/>));`,resolveDir:process.cwd(),loader:"tsx"},
    bundle:true,write:false,outfile:"completion.js",platform:"browser",jsx:"automatic",external:["/portal/*"],loader:{".css":"local-css"},define:{"process.env.NODE_ENV":'"production"'},
    plugins:[{name:"next",setup(builder){
      builder.onResolve({filter:/Course(Model|Pdf)Preview$/},args=>({path:args.path,namespace:"unrelated"}));
      builder.onLoad({filter:/.*/,namespace:"unrelated"},()=>({contents:"export const CourseModelPreview=()=>null;export const CoursePdfPreview=()=>null;"}));
      builder.onResolve({filter:/^next\/(image|link|navigation|dynamic)$/},args=>({path:args.path,namespace:"next"}));
      builder.onLoad({filter:/.*/,namespace:"next"},args=>({resolveDir:process.cwd(),loader:"tsx",contents:args.path === "next/navigation" ? "export function useRouter(){return {refresh(){window.refreshed=true},push(href){window.modeDestination=href}}}" : args.path === "next/dynamic" ? "export default function dynamic(){return ()=>null}" : args.path === "next/link" ? "import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>;}" : "import React from 'react';export default function Image({unoptimized,...props}){return <img {...props}/>;}"}));
    }}],
  });
  const browser = await chromium.launch();
  await mkdir("test-results/video-exhibit",{recursive:true});
  try {
    for(const locale of ["en-GB","zh-CN"] as const) {
      const page = await browser.newPage({viewport:{width:1440,height:1024}});
      const studyEvents: {path:string; body:{event:string;clientEventId?:string;contentId?:string;learningMode?:string}}[]=[];
      let openFailure: "http" | "network" | null = null;
      let modeFailure = false;
      await page.route("http://exhibit.test/**",async route=>{
        const url=new URL(route.request().url());
        if(url.pathname.startsWith("/portal/")) return route.fulfill({body:await readFile(path.join("public",url.pathname)),contentType:url.pathname.endsWith(".svg")?"image/svg+xml":url.pathname.endsWith(".webm")?"video/webm":url.pathname.endsWith(".obj")?"text/plain":"image/png"});
        if(url.pathname.startsWith("/api/")) {
          if(url.pathname.endsWith("/learning-mode")) return route.fulfill({ status: modeFailure ? 503 : 200, json: { ok: !modeFailure } });
          if(url.pathname.startsWith("/api/study/")) {
            const body=route.request().postDataJSON();
            studyEvents.push({path:url.pathname,body});
            if(body.event==="open" && openFailure) return openFailure==="network" ? route.abort("failed") : route.fulfill({status:503,json:{error:"unavailable"}});
          }
          return route.fulfill({contentType:"application/json",body:'{"record":{}}'});
        }
        if(url.pathname.endsWith("mp4"))return route.fulfill({status:404,body:""});
        return route.fulfill({contentType:"text/html",body:'<div id="root"></div>'});
      });
      await page.goto("http://exhibit.test");
      for(const file of ["app/styles.css","app/portal-design.css","components/portal/lesson-authoring.css"])await page.addStyleTag({content:await readFile(file,"utf8")});
      await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith("css"))!.text});
      for(const weight of [400,500,600,700]){const font=(await readFile(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`)).toString("base64");await page.addStyleTag({content:`@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font});font-weight:${weight}}`});}
      await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith("js"))!.text});
      const lesson={id:"lesson",title:"Looking closely",body:"",durationMinutes:2,contents:[{id:"video",title:"Observe composition",type:"video",mode:"lecture",url:"/fixture.mp4",nodes:[{id:"first",title:"Garden composition study",type:"model3d",url:"/garden.glb",triggerTime:10},{id:"second",title:"Second exhibit",type:"text",html:"<p>Configured exhibit content.</p>",triggerTime:20},{id:"picture",title:"Image exhibit",type:"image",url:"/portal/exh.jpg",triggerTime:25},{id:"inactive",title:"Hidden exhibit",type:"image",url:"/portal/exhibit-prompt/thumbnail.png",triggerTime:5,active:false}]}]};
      const mount=(key:string,entitled=true)=>page.evaluate(props=>(window as unknown as {mount:(p:unknown)=>void}).mount(props),{locale,key,lesson,courseId:"course",courseTitle:"The Art of Seeing",category:"Art",description:"Observe with attention.",poster:"/portal/course-study.jpg",outline:[{id:"lesson",number:"01",title:lesson.title,href:"/lesson"}],nextHref:null,initialCompleted:false,entitled,trialGate:entitled?undefined:{pricingHref:"/subscription",recommendations:[],videoLimitSeconds:15}});
      lesson.contents.push({id:"text",title:"Read visual cues",type:"text",mode:"lecture",html:"<p>Mode switch reading content.</p>",nodes:[]} as unknown as typeof lesson.contents[number]);
      const entryProps={locale,key:"entry-mismatch",lesson:{...lesson,contents:lesson.contents.slice(0,1)},courseId:"course",courseTitle:"The Art of Seeing",category:"Art",description:"Observe with attention.",poster:"/portal/course-study.jpg",outline:[{id:"lesson",number:"01",title:lesson.title,href:"/lesson",modes:["video"]}],nextHref:null,initialCompleted:false,entitled:true,preferredMode:"text"};
      await page.evaluate(props=>(window as unknown as {mount:(p:unknown)=>void}).mount(props),entryProps);
      assert.equal(await page.locator('select:has(option[value="text"])').count(),0);
      const fixedMode = page.locator('[data-learning-mode]');
      assert.equal(await fixedMode.textContent(), getMessages(locale).previewVideoDesign.videoMode);
      assert.equal(await fixedMode.evaluate(e => getComputedStyle(e).color), "rgb(148, 163, 184)");
      assert.equal(await fixedMode.locator('..').locator('img, select, button').count(), 0);
      await page.screenshot({path:`test-results/video-exhibit/${locale}-single-video-mode.png`,fullPage:true});
      for (const contents of [lesson.contents.filter(item=>item.type==="text"), []]) {
        await page.evaluate(props=>(window as unknown as {mount:(p:unknown)=>void}).mount(props), {...entryProps,lesson:{...lesson,body:contents.length ? "" : "Legacy reading",contents},outline:entryProps.outline.map(item=>({...item,modes:["text"]}))});
        assert.equal(await fixedMode.textContent(), getMessages(locale).previewVideoDesign.textMode);
        assert.equal(await page.locator('select:has(option[value="text"])').count(),0);
        assert.equal(await fixedMode.evaluate(e => e.matches('a,button,input,select,[tabindex]')),false);
        await page.setViewportSize({width:390,height:844});
        await page.screenshot({path:`test-results/video-exhibit/${locale}-single-text-mode-${contents.length}.png`,fullPage:true});
      }
      await page.setViewportSize({width:1440,height:1024});
      await page.evaluate(props=>(window as unknown as {mount:(p:unknown)=>void}).mount(props),entryProps);
      await page.locator("video.la-lesson-video").waitFor();
      await page.evaluate(props=>(window as unknown as {mount:(p:unknown)=>void}).mount(props),{...entryProps,lesson,outline:[{...entryProps.outline[0],modes:["video","text"]}],preferredMode:"text",initialContentId:"video"});
      await page.getByText("Mode switch reading content.",{exact:true}).waitFor();
      assert.equal(await page.locator('select:has(option[value="text"])').inputValue(),"text");
      await page.evaluate(props=>(window as unknown as {mount:(p:unknown)=>void}).mount(props),{...entryProps,lesson,outline:[{...entryProps.outline[0],modes:["video","text"]}],preferredMode:"video"});
      await page.locator("video.la-lesson-video").waitFor();
      assert.equal(await page.locator('select:has(option[value="text"])').inputValue(),"video");
      await page.evaluate(props=>(window as unknown as {mount:(p:unknown)=>void}).mount(props),{locale,key:"mode-switch",lesson,courseId:"course",courseTitle:"The Art of Seeing",category:"Art",description:"Observe with attention.",poster:"/portal/course-study.jpg",outline:[{id:"lesson",number:"01",title:lesson.title,href:"/lesson",modes:["video","text"]},{id:"video-only",number:"02",title:"Video-only lesson",href:"/video-lesson",modes:["video"]},{id:"text-only",number:"03",title:"Text-only lesson",href:"/text-lesson",modes:["text"]},{id:"locked-text",number:"04",title:"Locked text lesson",href:null,modes:["text"]}],nextHref:null,initialCompleted:false,entitled:true,studyEndpoint:"/api/study/events"});
      const modeSwitch=page.getByRole("combobox",{name:locale==="en-GB"?"Learning mode":"学习模式"});
      await modeSwitch.waitFor();
      await page.locator('nav [aria-current="page"]').filter({hasText:locale==="en-GB"?"Lesson":"课时"}).waitFor();
      assert.equal(await modeSwitch.evaluate(e=>getComputedStyle(e).paddingLeft),"6px");
      assert.equal(await modeSwitch.evaluate(e=>e.getBoundingClientRect().width===e.parentElement!.getBoundingClientRect().width),true);
      await page.waitForLoadState("networkidle");
      assert.notEqual(await page.evaluate(()=>(window as unknown as {refreshed?:boolean}).refreshed),true,"background open saves must not refresh and interrupt the mode dropdown");
      assert.equal(studyEvents.some(event=>event.path==="/api/study/events" && event.body.contentId==="video"),false,"selecting a video does not save course progress before playback");
      await Promise.all([page.waitForResponse(response=>response.url().endsWith('/api/study/events')&&response.request().postDataJSON()?.contentId==='video'),page.locator('video').evaluate(video=>video.dispatchEvent(new Event('play')))]);
      assert.ok(studyEvents.some(event=>event.path==="/api/study/events" && event.body.event==="open" && event.body.contentId==="video" && event.body.learningMode==="video" && event.body.clientEventId?.startsWith("open_")));
      assert.equal(await modeSwitch.inputValue(),"video");
      modeFailure=true;await modeSwitch.selectOption("text");
      await page.getByRole("alert").filter({hasText:getMessages(locale).courseLearningMode.saveError}).waitFor();
      assert.equal(await modeSwitch.inputValue(),"video","failed mode saves retain the current presentation for retry");
      modeFailure=false;
      const textSaved=page.waitForRequest(request=>request.url().endsWith("/api/study/events")&&request.postDataJSON()?.contentId==="text");
      await modeSwitch.selectOption("text");
      await textSaved;
      assert.equal(await page.evaluate(()=>(window as unknown as {modeDestination:string}).modeDestination),"/lesson?viewMode=text&contentId=text");
      assert.equal(await page.getByRole("link",{name:/Video-only lesson/}).count(),0);
      assert.equal(await page.getByRole("link",{name:/Text-only lesson/}).getAttribute("href"),"/text-lesson?viewMode=text");
      assert.equal(await page.getByRole("link",{name:/Locked text lesson/}).count(),0);
      await page.getByText("Mode switch reading content.",{exact:true}).waitFor();
      assert.equal(await page.locator("video.la-lesson-video").count(),0);
      await modeSwitch.selectOption("video");
      await page.locator("video.la-lesson-video").waitFor();
      assert.equal(await page.getByRole("link",{name:/Text-only lesson/}).count(),0);
      assert.equal(await page.getByRole("link",{name:/Video-only lesson/}).count(),1);
      await page.locator("video.la-lesson-video").waitFor();
      const videoBounds=(await page.locator("video.la-lesson-video").boundingBox())!;
      assert.equal(videoBounds.width,900);
      assert.equal(videoBounds.height,506.25);
      const deepTools=page.getByRole("complementary",{name:locale==="en-GB"?"Deep Learning":"深度学习"});
      assert.equal((await deepTools.boundingBox())!.width,160);
      for(const action of await deepTools.locator("a,button").all()) {
        const bounds=(await action.boundingBox())!;assert.equal(bounds.width,160);assert.ok(bounds.height>=52);
        assert.deepEqual(await action.evaluate(e=>{const s=getComputedStyle(e),label=getComputedStyle(e.lastElementChild!);return {size:label.fontSize,weight:label.fontWeight,border:s.borderTopWidth,radius:s.borderTopLeftRadius};}),{size:"13px",weight:"500",border:"1px",radius:"12px"});
      }
      for(const [asset,width,height] of [["tutor",16,16],["understanding",16,16],["explore",16,16],["divider",940,1]] as const) {
        const icon=page.locator(`img[src="/portal/study/${asset}.svg"]`);await icon.evaluate(image=>(image as HTMLImageElement).decode());
        assert.deepEqual(await icon.evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),{width,height});
        assert.ok((await readFile(`public/portal/study/${asset}.svg`)).length>0);
      }
      await page.screenshot({path:`test-results/video-exhibit/${locale}-study-layout.png`,fullPage:true});
      for(const width of [1280,1200,768,390,320]) {
        await page.setViewportSize({width,height:900});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`video layout fits ${width}px`);
        const videoBox=(await page.locator("video.la-lesson-video").boundingBox())!;
        assert.ok(Math.abs(videoBox.width/videoBox.height-16/9)<.01);
        for(const action of await deepTools.locator("a,button").all()) {
          const bounds=(await action.boundingBox())!;assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);
        }
        if(width===390) await page.screenshot({path:`test-results/video-exhibit/${locale}-study-layout-mobile.png`,fullPage:true});
      }
      await page.setViewportSize({width:1440,height:1024});
      await page.getByRole("button",{name:new RegExp(locale==="en-GB"?"Ask AI Tutor":"AI")}).click();
      await page.locator(".tutor-panel textarea").waitFor();
      const sidebar=page.locator("aside").first();
      const titleBox=(await sidebar.locator("h2").boundingBox())!, switchBox=(await modeSwitch.boundingBox())!;
      const firstLessonBox=(await sidebar.locator("nav > div").first().boundingBox())!;
      assert.ok(switchBox.y>=titleBox.y+titleBox.height);
      assert.equal(switchBox.width,96);assert.equal(switchBox.height,18);
      assert.deepEqual(await modeSwitch.evaluate(e=>{const s=getComputedStyle(e);return {size:s.fontSize,weight:s.fontWeight,border:s.borderTopWidth,shadow:s.boxShadow};}),{size:"12px",weight:"400",border:"0px",shadow:"none"});
      assert.ok(firstLessonBox.y>=switchBox.y+switchBox.height+20);
      assert.equal(await sidebar.getByRole('link',{name:/Back to course details|返回课程详情/}).count(),0);
      assert.equal(await sidebar.getByText('COURSE OUTLINE',{exact:true}).count(),0);
      assert.equal(await page.locator('.la-node-links').count(),0);
      const modeIcon=sidebar.locator('img[src="/portal/learning-mode/dropdown.svg"]');
      await modeIcon.evaluate(image=>(image as HTMLImageElement).decode());
      const iconBox=(await modeIcon.boundingBox())!;
      assert.ok(Math.abs(iconBox.width-10.3923)<.05 && iconBox.height===9);
      assert.ok(iconBox.x>=switchBox.x&&iconBox.x+iconBox.width<=switchBox.x+96);
      await page.screenshot({path:`test-results/video-exhibit/${locale}-mode-switch.png`,fullPage:true});
      // The AI Tutor is a modal drawer: close it before interacting with the page behind it.
      await page.keyboard.press("Escape");
      await page.locator(".tutor-panel").waitFor({state:"detached"});
      await page.setViewportSize({width:390,height:844});
      await modeSwitch.selectOption("text");
      assert.equal((await modeSwitch.boundingBox())!.width,96);
      await page.getByText("Mode switch reading content.",{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:`test-results/video-exhibit/${locale}-mode-switch-mobile.png`,fullPage:true});
      await page.setViewportSize({width:1440,height:1024});
      lesson.contents.pop();
      const time=async(seconds:number,event="timeupdate")=>{await page.locator("video").waitFor();await page.locator("video").evaluate((element,{seconds,event})=>{Object.defineProperty(element,"duration",{configurable:true,value:120});Object.defineProperty(element,"currentTime",{configurable:true,writable:true,value:seconds});element.dispatchEvent(new Event(event));},{seconds,event});};
      const bar=page.getByRole("region",{name:locale==="en-GB"?"Exhibit Available":"\u53ef\u67e5\u770b\u5c55\u793a\u5185\u5bb9"});
      for (const entitled of [false,true]) {
        for (const failure of ["http","network"] as const) {
          openFailure=failure;
          await mount(`silent-${entitled}-${failure}`,entitled);
          await page.locator("video.la-lesson-video").waitFor();
          const saved=failure==="http"
            ? page.waitForEvent("response",event=>event.url().endsWith("/api/study/preview"))
            : page.waitForEvent("requestfailed",event=>event.url().endsWith("/api/study/preview"));
          await page.locator("video.la-lesson-video").evaluate(video=>{
            video.dispatchEvent(new Event("error"));
            video.dispatchEvent(new Event("play"));
          });
          await saved;await page.waitForLoadState("networkidle");
          assert.equal(await page.getByText(lessonMessages(locale).mediaFailed,{exact:true}).count(),0,"unavailable media has no notice");
          assert.equal(await page.getByText(getMessages(locale).overviewDesign.previewSaveError,{exact:true}).count(),0,"failed background progress saves have no notice");
          assert.equal(await page.locator(".la-content-player [role=status],.la-content-player [role=alert],.preview-progress").count(),0,"no feedback block is rendered in or below the player");
          assert.ok(studyEvents.some(event=>event.body.event==="open" && event.body.contentId==="video"),"progress still saves in the background");
        }
      }
      const controls=page.locator(".la-video-controls");
      await page.mouse.move(0,0);
      assert.equal(await controls.evaluate(element=>getComputedStyle(element).opacity),"0","playing video hides controls when the pointer leaves");
      await page.screenshot({path:`test-results/video-exhibit/${locale}-playing-controls-hidden.png`,fullPage:true});
      await page.locator("video.la-lesson-video").hover();
      assert.equal(await controls.evaluate(element=>getComputedStyle(element).opacity),"1","hovering over the player shows its controls");
      await page.screenshot({path:`test-results/video-exhibit/${locale}-playing-controls-hover.png`,fullPage:true});
      await page.screenshot({path:`test-results/video-exhibit/${locale}-silent-video-desktop.png`,fullPage:true});
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:`test-results/video-exhibit/${locale}-silent-video-mobile.png`,fullPage:true});
      await page.setViewportSize({width:1440,height:1024});
      openFailure=null;
      const validVideoUrl=lesson.contents[0].url;
      lesson.contents[0].url="javascript:invalid";
      await mount("invalid-video-url");
      assert.equal(await page.getByText(lessonMessages(locale).invalidUrl,{exact:true}).count(),0);
      assert.equal(await page.locator("video.la-lesson-video").count(),0,"invalid video URLs remain blocked without feedback");
      lesson.contents[0].url=validVideoUrl;
      await mount("interrupted-playback");
      await page.locator("video.la-lesson-video").waitFor();
      await page.addScriptTag({content:`(video=>{
        video.play=async()=>{throw new DOMException("Interrupted by pause","AbortError");};
        let paused=false;
        Object.defineProperty(video,"paused",{configurable:true,get:()=>paused});
        video.pause=()=>{paused=true;};
      })(document.querySelector('video.la-lesson-video'));`});
      await page.locator(".la-video-play").click();
      assert.equal(await page.getByText(lessonMessages(locale).playbackBlocked,{exact:true}).count(),0,"cover play interruption has no operation notice");
      await time(20);await bar.waitFor();
      await bar.getByRole("button",{name:getMessages(locale).videoExhibit.view,exact:true}).click();
      await page.getByRole("dialog").waitFor();await page.keyboard.press("Escape");
      assert.equal(await page.getByText(lessonMessages(locale).playbackBlocked,{exact:true}).count(),0,"interrupted resume has no operation notice");
      await page.locator("video.la-lesson-video").evaluate(video=>video.dispatchEvent(new Event("error")));
      assert.equal(await page.getByText(lessonMessages(locale).mediaFailed,{exact:true}).count(),0,"media errors have no playback notice");
      await mount("normal");await time(9.99);assert.equal(await bar.count(),0);
      assert.equal(await modeSwitch.count(),0,"a single-mode course has no dropdown");
      await time(10);await bar.waitFor();assert.equal(await page.getByRole("dialog").count(),0,"time point offers an exhibit without opening a modal");
      assert.equal((await bar.boundingBox())!.height,335);assert.equal((await bar.boundingBox())!.width,164);const thumbnail=bar.locator('img[width="140"]');await thumbnail.evaluate(image=>(image as HTMLImageElement).decode());assert.deepEqual(await thumbnail.evaluate(image=>({width:image.getBoundingClientRect().width,height:image.getBoundingClientRect().height})),{width:140,height:140});
      const pointer=bar.locator('[data-exhibit-pointer]');await pointer.evaluate(image=>(image as HTMLImageElement).decode());
      const arrowBox=(await pointer.boundingBox())!, exploreIcon=(await page.locator('img[src="/portal/study/explore.svg"]').boundingBox())!;
      assert.ok(Math.abs(arrowBox.x+arrowBox.width/2-exploreIcon.x-exploreIcon.width/2)<1,`pointer aligns to Explore further icon centre: ${JSON.stringify({arrowBox,exploreIcon})}`);
      assert.ok((await bar.boundingBox())!.x>(await page.locator('video.la-lesson-video').boundingBox())!.x+(await page.locator('video.la-lesson-video').boundingBox())!.width,"normal bubble is to the right of the video");
      assert.equal(await pointer.evaluate(e=>e.getBoundingClientRect().width),20);
      assert.equal(await bar.locator('img[src="/portal/exhibit-prompt/close.svg"]').evaluate(e=>e.getBoundingClientRect().width),16);
      await page.screenshot({path:`test-results/video-exhibit/${locale}-desktop.png`,fullPage:true});
      await bar.getByRole("button").first().click();assert.equal(await bar.count(),0);await time(11);assert.equal(await bar.count(),0,"dismissed node does not immediately reappear");
      await time(20);await bar.waitFor();
      assert.equal(studyEvents.some(event=>event.body.event==="video_progress"),false,"playback time does not emit course progress writes");
      await bar.getByRole("button",{name:getMessages(locale as "en-GB" | "zh-CN").videoExhibit.view,exact:true}).click();await page.getByRole("dialog").waitFor();await page.getByRole("dialog").getByText("Configured exhibit content.").waitFor();await page.keyboard.press("Escape");
      await time(25); await bar.waitFor();
      await page.locator("video").evaluate(`video=>{let paused=false;Object.defineProperty(video,"paused",{configurable:true,get:()=>paused});video.pause=()=>{paused=true;};video.play=()=>{paused=false;return Promise.resolve();};}`);
      await bar.getByRole("button",{name:getMessages(locale as "en-GB" | "zh-CN").videoExhibit.view,exact:true}).click(); await page.getByRole("dialog").waitFor(); await page.getByRole("dialog").locator('img[alt="Image exhibit"]').waitFor();
      assert.equal(await page.locator("video").evaluate(video=>(video as HTMLVideoElement).paused),true); await page.keyboard.press("Escape");
      assert.equal(await page.locator("video").evaluate(video=>{ const media = video as HTMLVideoElement; return media.paused && media.currentTime===25; }),true,"closing the exhibit leaves lesson paused at the same point");

      await time(9,"seeked");await time(10);await bar.waitFor();await page.setViewportSize({width:390,height:844});await page.screenshot({path:`test-results/video-exhibit/${locale}-mobile.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      const mobileBubble=(await bar.boundingBox())!;for(const element of await bar.locator('h2,button').all()){const bounds=(await element.boundingBox())!;assert.ok(bounds.y>=mobileBubble.y&&bounds.y+bounds.height<=mobileBubble.y+mobileBubble.height,"mobile bubble contains its title and actions");}
      const originalTitle=lesson.contents[0].nodes[0].title;
      lesson.contents[0].nodes[0].title=locale==="en-GB" ? "Three examples of one-dimensional state spaces: voltage, population size and the fraction of a wolf population that has a particular gene" : "一维状态空间的三个实例：电压、种群数量，以及狼群中携带特定基因的个体比例。这些实例说明如何选择描述系统状态的变量。";
      await mount("multiline-exhibit-title");await time(10);await bar.waitFor();
      const assertNaturalTitle=async(bubble:typeof bar)=>{
        const heading=bubble.locator("h2");
        const metrics=await heading.evaluate(element=>({height:element.clientHeight,scrollHeight:element.scrollHeight,overflow:getComputedStyle(element).overflowY}));
        assert.equal(metrics.scrollHeight,metrics.height,"the complete title fits without its own scrollbar");
        assert.equal(metrics.overflow,"visible");
        const bubbleBox=(await bubble.boundingBox())!,titleBox=(await heading.boundingBox())!;
        for(const action of await bubble.getByRole("button").all()){
          const box=(await action.boundingBox())!;
          assert.ok(box.y>=bubbleBox.y&&box.y+box.height<=bubbleBox.y+bubbleBox.height,"actions stay within the naturally sized card");
          if(await action.textContent())assert.ok(box.y>=titleBox.y+titleBox.height,"actions follow the complete title");
        }
        assert.equal(await bubble.evaluate(element=>element.scrollHeight<=element.clientHeight),true,"the card itself does not scroll");
      };
      for(const width of [1440,390]){
        await page.setViewportSize({width,height:900});await assertNaturalTitle(bar);
        assert.ok((await bar.boundingBox())!.height>335,"long titles expand the card");
        await page.screenshot({path:`test-results/video-exhibit/${locale}-multiline-title-${width}.png`,fullPage:true});
      }
      await page.setViewportSize({width:1440,height:900});
      await page.locator('.la-controlled-video').evaluate(container=>{Object.defineProperty(container,"requestFullscreen",{value:undefined,configurable:true});});
      await page.locator('.la-controlled-video .la-video-controls').getByRole('button').last().click();
      const multilineFullscreen=page.locator('.la-video-expanded [data-video-exhibit="fullscreen"]');await multilineFullscreen.waitFor();await assertNaturalTitle(multilineFullscreen);
      lesson.contents[0].nodes[0].title=locale==="en-GB" ? "Three examples of one-dimensional state spaces" : "一维状态空间的三个实例：电压、种群数量以及比例";
      await mount("multiline-landscape");await time(10);
      await page.locator('.la-controlled-video').evaluate(container=>{Object.defineProperty(container,"requestFullscreen",{value:undefined,configurable:true});});
      await page.locator('.la-controlled-video .la-video-controls').getByRole('button').last().click();await page.setViewportSize({width:844,height:390});await multilineFullscreen.waitFor();await assertNaturalTitle(multilineFullscreen);
      await page.screenshot({path:`test-results/video-exhibit/${locale}-multiline-title-landscape.png`,fullPage:true});
      lesson.contents[0].nodes[0].title=originalTitle;await mount("after-multiline-title");await time(10);
      await time(30,"seeked");assert.equal(await bar.count(),0,"forward seek clears prompt and skips prior nodes");
      await mount("trial",false);await time(20);assert.equal(await bar.count(),0,"trial gate runs before timed nodes");
      const configuredNodes=lesson.contents[0].nodes;lesson.contents[0].nodes=[];
      lesson.contents[0].url="/portal/text-exhibits/flowers.webm";
      await page.setViewportSize({width:1440,height:900});
      await mount("timed-samples");
      const fullscreenBar=page.locator('[data-video-exhibit="fullscreen"]');
      for(const [seconds,kind] of [[20,"image"],[40,"video"],[60,"model3d"]] as const) {
        await page.locator('.la-controlled-video .la-video-controls').getByRole('button').last().click();
        await page.waitForFunction(()=>document.fullscreenElement?.classList.contains('la-controlled-video'));
        await time(seconds-.01);assert.equal(await fullscreenBar.count(),0);
        await time(seconds);await fullscreenBar.waitFor();
        assert.equal(await fullscreenBar.evaluate(e=>document.fullscreenElement?.contains(e)),true,"prompt is inside the native fullscreen container");
        assert.equal(await fullscreenBar.locator("[data-exhibit-pointer]").count(),0,"fullscreen bubble has no upward pointer");
        const promptBox=(await fullscreenBar.boundingBox())!;assert.equal(promptBox.width,164);assert.equal(promptBox.height,335);assert.ok(promptBox.x>await page.evaluate(()=>innerWidth/2));assert.ok(promptBox.y>=0&&promptBox.y+promptBox.height<=await page.evaluate(()=>innerHeight));
        assert.equal(await fullscreenBar.getByText(locale==="en-GB"?(kind==="model3d"?"3D Model":kind==="image"?"Image":"Video"):(kind==="model3d"?"3D 模型":kind==="image"?"图片":"视频"),{exact:true}).count(),1);
        await page.screenshot({path:`test-results/video-exhibit/${locale}-${seconds}s-${kind}.png`,fullPage:true});
        await fullscreenBar.getByRole("button",{name:getMessages(locale as "en-GB" | "zh-CN").videoExhibit.view,exact:true}).click();await page.getByRole("dialog").waitFor();
        assert.equal(await page.evaluate(()=>document.fullscreenElement===null),true);
        if(kind==="image")await page.getByRole("dialog").locator('img[alt]:not([alt=""])').waitFor();
        if(kind==="video")await page.getByRole("dialog").locator("video").waitFor();
        await page.keyboard.press("Escape");assert.equal(await fullscreenBar.count(),0);
        assert.equal(await page.locator('video.la-lesson-video').evaluate((v,seconds)=>(v as HTMLVideoElement).paused && (v as HTMLVideoElement).currentTime===seconds,seconds),true);
        await time(seconds+1);assert.equal(await fullscreenBar.count(),0,"viewed samples do not immediately repeat");
      }
      await time(19,"seeked");await time(20);await bar.waitFor();await bar.getByRole("button").first().click();
      await time(39,"seeked");
      await page.locator('.la-controlled-video').evaluate(container=>{Object.defineProperty(container,"requestFullscreen",{value:undefined,configurable:true});});
      await page.locator('.la-controlled-video .la-video-controls').getByRole('button').last().click();await page.locator('.la-video-expanded').waitFor();
      const expandedBar=page.locator('.la-video-expanded [data-video-exhibit="fullscreen"]');
      await time(40);await expandedBar.waitFor();assert.equal(await expandedBar.evaluate(e=>!!e.closest('.la-video-expanded')),true);
      await page.setViewportSize({width:844,height:390});assert.equal(await expandedBar.locator('[data-exhibit-pointer]').count(),0);const shortBox=(await expandedBar.boundingBox())!;assert.ok(shortBox.y>=0&&shortBox.y+shortBox.height<390);await page.screenshot({path:`test-results/video-exhibit/${locale}-fullscreen-landscape.png`,fullPage:true});
      await expandedBar.getByRole("button",{name:getMessages(locale as "en-GB" | "zh-CN").videoExhibit.view,exact:true}).click();await page.getByRole('dialog').waitFor();assert.equal(await page.locator('.la-video-expanded').count(),0);await page.keyboard.press('Escape');
      await mount("sample-trial",false);await time(60);assert.equal(await bar.count(),0,"sample model cannot bypass the trial limit");
      lesson.contents[0].nodes=configuredNodes;
      await page.close();
    }
  } finally {await browser.close();}
});

import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdir,readFile} from "node:fs/promises";
import path from "node:path";
import {build} from "esbuild";
import {chromium} from "playwright";
import {modelingLifeCourse} from "../../db/data-migrations/008_upgrade_modeling_life";
import * as textExhibits from "../../db/data-migrations/016_add_modeling_life_lesson1_text_exhibits";
import * as videoStarts from "../../db/data-migrations/017_fix_modeling_life_video_starts";
import * as lesson2Readings from "../../db/data-migrations/018_add_modeling_life_lesson2_readings";
import * as lesson2Exhibits from "../../db/data-migrations/019_add_modeling_life_lesson2_exhibits";
import {createMemoryOrm} from "../../services/dataMigrations";
import type {ProductCourse} from "../../services/productStore";
import {buildTextLessonPreview} from "../../services/textLessonPreview";
import {previewLessonOutline} from "../../lib/previewLessonPresentation";
import {courseExploration,lessonAssessmentAvailability} from "../../lib/lessonResources";
import {getMessages} from "../../lib/i18n/messages";
import {isolate,jsonRequest,setCookie,SESSION_COOKIE} from "../io/harness";
import {verifiedUser} from "./helpers/my-learning";

test("Modeling life renders authored bilingual text, timed video points, resources and real eighteen-card saved tests",{timeout:120000},async()=>{
  const cwd=process.cwd(),output=path.join(cwd,"test-results/modeling-life/browser");await mkdir(output,{recursive:true});
  const bundle=await build({stdin:{resolveDir:cwd,loader:"tsx",contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PreviewLessonView} from './components/portal/PreviewLessonView';import {PersistedAssessmentDialog} from './components/portal/PersistedAssessmentDialog';import {UnderstandingOverview} from './components/portal/UnderstandingOverview';const root=createRoot(document.getElementById('root'));window.mount=p=>flushSync(()=>root.render(<main className="portal-page portal-public-lesson-page">{p.view==='assessment'?<PersistedAssessmentDialog key={p.key} {...p} onExit={()=>root.render(null)}/>:p.view==='overview'?<UnderstandingOverview key={p.key} {...p}/>:<PreviewLessonView key={p.key} {...p}/>}</main>));`},bundle:true,write:false,outfile:"modeling.js",platform:"browser",jsx:"automatic",external:["/portal/*"],loader:{".css":"local-css"},define:{"process.env.NODE_ENV":'"production"'},plugins:[{name:"next",setup(b){
    b.onResolve({filter:/Course(Model|Pdf)Preview$/},args=>({path:args.path,namespace:"mock"}));
    b.onResolve({filter:/^next\//},args=>({path:args.path,namespace:"mock"}));
    b.onLoad({filter:/.*/,namespace:"mock"},args=>({resolveDir:cwd,loader:"tsx",contents:args.path.endsWith("Preview")?"export const CourseModelPreview=()=>null;export const CoursePdfPreview=()=>null":args.path==="next/navigation"?"export const useRouter=()=>({refresh(){},push(href){window.destination=href}})":args.path==="next/dynamic"?"export default ()=>()=>null":args.path==="next/link"?"import React from 'react';export default function Link({prefetch,...p}){return <a {...p}/>}":"import React from 'react';export default function Image({unoptimized,fill,...p}){return <img {...p} style={{...p.style,...(fill?{width:'100%',height:'100%',objectFit:'contain'}:{})}}/>}"}));
  }}]});
  const {restore}=await isolate("lg-modeling-browser-");
  const browser=await chromium.launch();
  try{
    const store=await import("../../services/productStore"),assessments=await import("../../services/lessonAssessmentService");
    const routes=await import("../../app/api/courses/[courseId]/lessons/[lessonId]/assessments/[kind]/route");
    const overview=await import("../../services/understandingOverview");
    const fixture=modelingLifeCourse("2026-10-23T00:00:00Z"),orm=createMemoryOrm({tables:{courses:[fixture]}});
    textExhibits.apply(orm,{store:"memory",dryRun:true,now:"2026-10-26T12:00:00Z"});
    videoStarts.apply(orm,{store:"memory",dryRun:true,now:"2026-10-26T12:00:00Z"});
    lesson2Readings.apply(orm,{store:"memory",dryRun:true,now:"2026-10-29T05:00:00Z"});
    lesson2Exhibits.apply(orm,{store:"memory",dryRun:true,now:"2026-10-29T08:00:00Z"});
    const course=orm.table<ProductCourse>("courses").findById(fixture.id)!,[first,second]=course.sections[0].lessons;
    for(const locale of ["en-GB","zh-CN"] as const){
      const user=await verifiedUser(store,`modeling-browser-${locale}@example.test`),session=await store.createSession(user.id);setCookie(SESSION_COOKIE,session.token);
      const {quote}=await store.createQuote(user.id,"science-pc-6");await store.completeDemoCheckout(user.id,quote.id);
      await store.recordStudyEvent({userId:user.id,courseId:course.id,lessonId:first.id,event:"complete",seconds:0,learningMode:"text",completeLesson:true,clientEventId:"browser-completed-study"});
      const page=await browser.newPage({viewport:{width:1440,height:1024}}),errors:string[]=[],traffic:string[]=[];page.on("pageerror",error=>errors.push(error.message));
      await page.route("**/*",async route=>{
        const request=route.request(),url=new URL(request.url());
        if(url.pathname.startsWith("/portal/")||url.pathname.startsWith("/courses/"))return route.fulfill({body:await readFile(path.join(cwd,"public",url.pathname)),contentType:url.pathname.endsWith(".svg")?"image/svg+xml":"image/png"});
        const media=url.pathname.match(/^\/api\/course-media\/modeling-life\/([0-9a-f-]+)$/);
        if(media){
          const files:Record<string,string>={"9a88e350-e44f-47b1-9518-ed8b50cc4d36":"lesson1-exhibit-1.png","3d1a37f4-6535-450c-879a-22c3cad48b08":"lesson1-exhibit-2.png","1b00006f-08ed-4f77-8285-a4685e3237de":"lesson1-exhibit-1-s.png","1d1e5a63-48ef-47b9-aeaf-b4a41b065515":"lesson1-exhibit-2-s.png"};
          const file=files[media[1]];
          if(!file)return route.fulfill({status:404});
          return route.fulfill({body:await readFile(path.join(cwd,"public/courses/modeling-life",file)),contentType:"image/png"});
        }
        const match=url.pathname.match(/^\/api\/courses\/([^/]+)\/lessons\/([^/]+)\/assessments\/(knowledge|application)$/);
        if(match){
          const context={params:Promise.resolve({courseId:match[1],lessonId:match[2],kind:match[3]})};
          const req=jsonRequest(request.method(),"http://localhost"+url.pathname,request.method()==="PUT"?request.postDataJSON():undefined);
          const response=await (request.method()==="PUT"?routes.PUT(req,context):routes.GET(req,context));
          traffic.push(`${request.method()} ${match[3]} ${response.status}`);
          return route.fulfill({status:response.status,body:await response.text(),contentType:"application/json"});
        }
        if(url.pathname.startsWith("/api/study/"))return route.fulfill({json:{record:{}}});
        if(url.hostname!=="modeling.test")return route.fulfill({status:204});
        return route.fulfill({contentType:"text/html",body:'<!doctype html><div id="root"></div>'});
      });
      await page.goto("http://modeling.test");
      for(const file of ["app/styles.css","app/portal-design.css","components/portal/lesson-authoring.css"])await page.addStyleTag({content:await readFile(path.join(cwd,file),"utf8")});
      await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith("css"))!.text});
      await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith("js"))!.text});
      const messages=getMessages(locale),mount=(p:unknown)=>page.evaluate(props=>(window as unknown as {mount:(p:unknown)=>void}).mount(props),p);
      const preview=buildTextLessonPreview(first,course.id,false);
      const base={locale,courseId:course.id,courseTitle:course.title,category:course.category,description:first.summary,poster:course.cover,lesson:{id:first.id,title:first.title,body:"",durationMinutes:first.durationMinutes,contents:first.contents},outline:previewLessonOutline(course,locale,true),assessmentAvailability:lessonAssessmentAvailability(first),initialCompleted:true,nextHref:null,entitled:true,preferredMode:"text"};
      await mount({...base,key:"preview",entitled:false,initialCompleted:false,lesson:{...base.lesson,...preview},textPreview:preview.textPreview,trialGate:{pricingHref:`/${locale}/subscription`,recommendations:[],videoLimitSeconds:600}});
      await page.locator('.la-prose img[src$="lesson-1-image1.png"]').waitFor();
      assert.equal(await page.locator(".la-prose img").count(),5);
      assert.equal(await page.locator('.la-prose').getByText(/状态变量/).count()>0,true);
      assert.equal(await page.locator('[data-text-preview-end]').count(),1);
      assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.locator('.la-exhibit-float').count(),0);
      assert.equal(await page.getByRole('region',{name:messages.videoExhibit.available}).count(),2,"authored text displays exactly the two requested exhibits");
      assert.equal(await page.locator('.la-node-links button').count(),0,"inline cards do not duplicate bottom exhibit links");
      for(const [index,anchor] of ["Our first example is going to be a single number.","T: Yes, that is the case. With electricity, the state variable might be voltage."].entries()){
        const card=page.locator(`[data-text-exhibit="modeling-life-l1-text-exhibit-${index+1}"]`),source=first.contents!.find(content=>content.type==='video')!.nodes[index];
        assert.equal(await card.evaluate((element,anchor)=>element.nextElementSibling?.textContent?.trim().startsWith(anchor),anchor),true);
        assert.equal(await card.locator(`img[src="${source.thumbnail}"]`).count(),1);
        await card.getByRole('button',{name:messages.videoExhibit.view,exact:true}).click();
        await page.getByRole('dialog').locator(`img[src="${source.url}"]`).waitFor();
        await page.getByText(source.description!,{exact:true}).waitFor();
        await page.screenshot({path:path.join(output,`${locale}-text-exhibit-${index+1}.png`),fullPage:true});
        await page.keyboard.press('Escape');
        await card.scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(output,`${locale}-text-card-${index+1}-desktop.png`),fullPage:true});
        await page.setViewportSize({width:390,height:844});
        await card.scrollIntoViewIfNeeded();
        assert.equal(await card.evaluate(element=>element.scrollWidth<=element.clientWidth),true,"mobile card contains its full title and action");
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await page.screenshot({path:path.join(output,`${locale}-text-card-${index+1}-mobile.png`),fullPage:true});
        await card.getByRole('button',{name:messages.videoExhibit.view,exact:true}).click();
        await page.getByRole('dialog').locator(`img[src="${source.url}"]`).waitFor();
        await page.keyboard.press('Escape');
        await page.setViewportSize({width:1440,height:1024});
      }
      for(const image of await page.locator('.la-prose img').all())assert.equal(await image.evaluate(async element=>{await (element as HTMLImageElement).decode();return (element as HTMLImageElement).naturalWidth>0;}),true);
      await page.screenshot({path:path.join(output,`${locale}-preview-desktop.png`),fullPage:true});
      await page.getByRole('button',{name:/^1\.2 Defining Vectors$/}).click();assert.equal(await page.locator('.la-prose img').count(),5,"preview retains only the first readable point");assert.equal(await page.getByRole('dialog').count(),0);
      await mount({...base,key:"full-text",explorationData:courseExploration(course)});
      await page.getByRole('button',{name:/^1\.2 Defining Vectors$/}).click();await page.locator('.la-prose img[src$="lesson-1-image6.png"]').waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight<innerHeight*3),true,"all chapter content remains inside the reading panel");
      await page.screenshot({path:path.join(output,`${locale}-text-desktop.png`),fullPage:true});
      await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(output,`${locale}-text-mobile.png`),fullPage:true});
      await page.setViewportSize({width:1440,height:1024});
      if(locale === "en-GB")for(const lesson of [first,second])for(const content of lesson.contents!.filter(point=>point.type === "text")){
        await mount({...base,key:content.id,initialContentId:content.id,description:lesson.summary,assessmentAvailability:lessonAssessmentAvailability(lesson),lesson:{id:lesson.id,title:lesson.title,body:"",durationMinutes:lesson.durationMinutes,contents:lesson.contents}});
        await page.locator(".la-prose").first().waitFor();
        assert.equal(await page.locator(`[data-text-point-id="${content.id}"] .la-prose img`).count(),(content.html!.match(/<img\b/g)||[]).length);
        for(const image of await page.locator(".la-prose img").all())assert.equal(await image.evaluate(async element=>{await (element as HTMLImageElement).decode();return (element as HTMLImageElement).naturalWidth>0;}),true);
        await page.waitForFunction(id => {
          const reader=document.querySelector('[data-text-reader]')!, point=reader.querySelector(`[data-text-point-id="${id}"]`)!;
          const offset=point.getBoundingClientRect().top-reader.getBoundingClientRect().top;
          return offset>=-1&&offset<reader.clientHeight;
        },content.id,{timeout:5000});
        if(lesson.id===second.id&&content===second.contents!.filter(point=>point.type==="text")[1]){
          await page.locator(".la-prose img").first().scrollIntoViewIfNeeded();
          await page.screenshot({path:path.join(output,"lesson-2-point-2-image.png"),fullPage:true});
        }
        await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.setViewportSize({width:1440,height:1024});
      }
      await mount({...base,key:"resources",explorationData:courseExploration(course)});
      await page.getByRole('button',{name:messages.previewVideoDesign.explore,exact:true}).click();let dialog=page.getByRole('dialog');
      assert.equal(await dialog.locator('article').count(),3);await dialog.getByText('Wikipedia, State Space Representation.',{exact:true}).waitFor();
      await page.screenshot({path:path.join(output,`${locale}-reading-list.png`),fullPage:true});
      await dialog.getByRole('button',{name:messages.exploration.wholeCourse,exact:true}).click();
      assert.equal(await dialog.locator('article').count(),6,"Whole course includes three readings for each Lesson");
      await dialog.getByText('Garfinkel, Shevtsov, Guo: Modeling Life, pp 16 – 23.',{exact:true}).waitFor();
      await dialog.getByText('Garfinkel, Shevtsov, Guo: Modeling Life, pp 24 – 31.',{exact:true}).waitFor();
      await dialog.getByRole('button',{name:messages.exploration.thisLesson,exact:true}).click();
      await dialog.getByRole('tab',{name:messages.exploration.exhibits,exact:true}).click();assert.equal(await dialog.locator('article').count(),2);
      await dialog.getByRole('button',{name:messages.exploration.wholeCourse,exact:true}).click();assert.equal(await dialog.locator('article').count(),4,"Whole course has two exhibits per Lesson");
      assert.equal(await dialog.locator('[data-exhibit-id="modeling-life-exhibit-1-3"],[data-exhibit-id="modeling-life-exhibit-1-8"]').count(),0);
      const exhibits=[['modeling-life-exhibit-1-2','1b00006f-08ed-4f77-8285-a4685e3237de','9a88e350-e44f-47b1-9518-ed8b50cc4d36'],['modeling-life-exhibit-1-4','1d1e5a63-48ef-47b9-aeaf-b4a41b065515','3d1a37f4-6535-450c-879a-22c3cad48b08']] as const;
      for(const [id,thumb,full] of exhibits){
        const card=dialog.locator(`[data-exhibit-id="${id}"]`);
        assert.equal(await card.locator(`img[src$="${thumb}"]`).count(),1);
        await card.click();await dialog.locator(`img[src$="${full}"]`).waitFor();await page.keyboard.press('Escape');
      }
      await page.screenshot({path:path.join(output,`${locale}-exploration-two-exhibits.png`),fullPage:true});
      await page.keyboard.press('Escape');
      await mount({...base,key:"lesson-2-readings",description:second.summary,lesson:{id:second.id,title:second.title,body:"",durationMinutes:second.durationMinutes,contents:second.contents},assessmentAvailability:lessonAssessmentAvailability(second),explorationData:courseExploration(course)});
      await page.getByRole('button',{name:messages.previewVideoDesign.explore,exact:true}).click();
      assert.equal(await dialog.locator('article').count(),3,"Lesson 2 has its own three readings");
      for(const reading of second.exploration!.readings)await dialog.getByText(reading.title,{exact:true}).waitFor();
      assert.equal(await dialog.getByText(first.exploration!.readings[0].title,{exact:true}).count(),0,"This lesson does not show Lesson 1 page ranges");
      await page.screenshot({path:path.join(output,`${locale}-lesson-2-reading-list-desktop.png`),fullPage:true});
      await page.setViewportSize({width:390,height:844});
      assert.equal(await dialog.locator('article').count(),3);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:path.join(output,`${locale}-lesson-2-reading-list-mobile.png`),fullPage:true});
      await dialog.getByRole('tab',{name:messages.exploration.exhibits,exact:true}).click();
      assert.equal(await dialog.locator('article').count(),2,"Lesson 2 has its own two Exhibits");
      for(const entry of second.exploration!.exhibits){
        const card=dialog.locator(`[data-exhibit-id="${entry.node.id}"]`);
        await card.locator(`img[src="${entry.thumbnail}"]`).waitFor();
        await card.click();await dialog.locator(`img[src="${entry.node.url}"]`).waitFor();await page.keyboard.press('Escape');
      }
      await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:1024});
      for(const [index,anchor] of ["T: Well let's work on that a little bit. 2m is of course, by definition, N plus P.","S: So stability changes as A moves past K then."].entries()){
        const card=page.locator(`[data-text-exhibit="modeling-life-l2-text-exhibit-${index+1}"]`),source=first.contents!.find(content=>content.type==='video')!.nodes[index];
        await card.waitFor();await card.scrollIntoViewIfNeeded();
        assert.equal(await page.locator(`[data-text-point-id="modeling-life-l2-text-${index+1}"] [data-text-exhibit]`).count(),1);
        assert.equal(await card.evaluate((element,anchor)=>element.nextElementSibling?.textContent?.trim().startsWith(anchor),anchor),true);
        await page.screenshot({path:path.join(output,`${locale}-lesson-2-text-exhibit-${index+1}-desktop.png`),fullPage:true});
        await card.getByRole('button',{name:messages.videoExhibit.view,exact:true}).click();
        await dialog.locator(`img[src="${source.url}"]`).waitFor();await page.getByText(source.description!,{exact:true}).waitFor();await page.keyboard.press('Escape');
        await page.setViewportSize({width:390,height:844});await card.scrollIntoViewIfNeeded();
        assert.equal(await card.evaluate(element=>element.scrollWidth<=element.clientWidth),true);
        await page.screenshot({path:path.join(output,`${locale}-lesson-2-text-exhibit-${index+1}-mobile.png`),fullPage:true});
        await card.getByRole('button',{name:messages.videoExhibit.view,exact:true}).click();await dialog.locator(`img[src="${source.url}"]`).waitFor();await page.keyboard.press('Escape');
        await page.setViewportSize({width:1440,height:1024});
      }
      await mount({...base,key:"video",preferredMode:"video"});
      const video=page.locator('video.la-lesson-video');await video.waitFor();
      const metadata=async()=>video.evaluate(el=>{Object.defineProperty(el,"duration",{configurable:true,value:1469});Object.defineProperty(el,"currentTime",{configurable:true,writable:true,value:0});el.dispatchEvent(new Event("loadedmetadata"));});
      const time=async(seconds:number)=>video.evaluate((el,seconds)=>{(el as HTMLVideoElement).currentTime=seconds;el.dispatchEvent(new Event("timeupdate"));},seconds);
      await metadata();assert.equal(await video.evaluate(el=>(el as HTMLVideoElement).currentTime),0);
      const bar=page.getByRole('region',{name:messages.videoExhibit.available});await time(37);await bar.waitFor();assert.equal(await bar.locator('img[src$="1b00006f-08ed-4f77-8285-a4685e3237de"]').count(),1);
      await bar.getByRole('button',{name:messages.videoExhibit.view,exact:true}).click();await dialog.locator('img[src$="9a88e350-e44f-47b1-9518-ed8b50cc4d36"]').waitFor();await page.getByText(first.contents!.find(c=>c.type==="video")!.nodes[0].description!,{exact:true}).waitFor();await page.screenshot({path:path.join(output,`${locale}-video-exhibit.png`),fullPage:true});await page.keyboard.press('Escape');
      await time(160);await bar.getByText('Three examples of one-dimensional state spaces',{exact:true}).waitFor();assert.equal(await bar.locator('img[src$="1d1e5a63-48ef-47b9-aeaf-b4a41b065515"]').count(),1);
      await page.getByRole('button',{name:/^1\.2 Defining Vectors$/}).click();assert.equal(await video.evaluate(el=>(el as HTMLVideoElement).currentTime),412);await bar.waitFor({state:"detached",timeout:5000}).catch(()=>{});assert.equal(await bar.count(),0);
      await mount({...base,key:"lesson-2-video",preferredMode:"video",description:second.summary,lesson:{id:second.id,title:second.title,body:"",durationMinutes:second.durationMinutes,contents:second.contents},assessmentAvailability:lessonAssessmentAvailability(second),explorationData:courseExploration(course)});
      await metadata();await time(36.9);assert.equal(await bar.count(),0);
      for(const [index,seconds] of [37,160].entries()){
        if(index===1){await time(159.9);assert.equal(await bar.count(),0);}
        await time(seconds);await bar.waitFor();
        const source=first.contents!.find(content=>content.type==='video')!.nodes[index];
        await bar.getByText(source.title,{exact:true}).waitFor();await bar.locator(`img[src="${source.thumbnail}"]`).waitFor();
        await page.screenshot({path:path.join(output,`${locale}-lesson-2-video-exhibit-${index+1}.png`),fullPage:true});
        await bar.getByRole('button',{name:messages.videoExhibit.view,exact:true}).click();await dialog.locator(`img[src="${source.url}"]`).waitFor();await page.getByText(source.description!,{exact:true}).waitFor();await page.keyboard.press('Escape');
        assert.equal(await bar.count(),0);
      }
      await mount({...base,key:"video-preview",entitled:false,preferredMode:"video",lesson:{...base.lesson,...preview},textPreview:preview.textPreview,trialGate:{pricingHref:`/${locale}/subscription`,recommendations:[],videoLimitSeconds:600}});
      await metadata();await time(599);assert.equal(await dialog.count(),0);await time(600);await dialog.waitFor();assert.equal(await video.evaluate(el=>(el as HTMLVideoElement).currentTime),600);await page.keyboard.press('Escape');
      await mount({view:"assessment",kind:"knowledge",key:"knowledge",locale,courseId:course.id,lessonId:first.id,lessonTitle:first.title,lessonNumber:"01"});
      dialog=page.getByRole('dialog');await dialog.getByText(first.assessments!.knowledge[0].prompt,{exact:true}).waitFor();
      assert.ok((await dialog.getByRole('progressbar').getAttribute('aria-valuemax'))==="18");
      await dialog.locator('textarea').fill('Saved Modeling life note');await page.screenshot({path:path.join(output,`${locale}-knowledge-first.png`),fullPage:true});
      for(let index=0;index<18;index++){
        await dialog.getByRole('button',{name:messages.knowledgeTest.check,exact:true}).click();await dialog.getByRole('radio').nth(1).check();
        await dialog.getByRole('button',{name:index===17?messages.knowledgeTest.seeResults:messages.knowledgeTest.next,exact:true}).click();
      }
      await dialog.getByText('100%',{exact:true}).waitFor();await page.waitForFunction(async()=>{const response=await fetch('/api/courses/modeling-life/lessons/modeling-life-lesson-1/assessments/knowledge');return Boolean((await response.json()).data?.completedAt);});
      let saved=await assessments.readAssessment(user.id,course.id,first.id,'knowledge');
      for(let i=0;i<100&&!saved?.completedAt;i++){await new Promise(resolve=>setTimeout(resolve,50));saved=await assessments.readAssessment(user.id,course.id,first.id,'knowledge');}
      assert.equal(saved?.attempt.kind==='knowledge'&&saved.attempt.responses.length,18,JSON.stringify({userId:user.id,saved,traffic,alerts:await page.getByRole('alert').allTextContents()}));
      assert.equal(saved?.attempt.kind==='knowledge'&&saved.attempt.responses[0].answer,'Saved Modeling life note');
      assert.ok(saved?.completedAt);
      await page.screenshot({path:path.join(output,`${locale}-knowledge-result.png`),fullPage:true});
      await mount({view:"assessment",kind:"application",key:"application",locale,courseId:course.id,lessonId:first.id,lessonTitle:first.title,lessonNumber:"01"});
      await dialog.locator('textarea').waitFor();await dialog.locator('textarea').fill('The mixed equilibrium consists of two thirds hawks and one third doves.');
      await dialog.getByRole('button',{name:messages.applicationTest.submit,exact:true}).click();await dialog.getByRole('button',{name:messages.applicationTest.retake,exact:true}).waitFor();
      await dialog.getByText(first.assessments!.application!.reference[0],{exact:true}).waitFor();
      assert.equal(await dialog.getByRole('heading',{name:messages.applicationTest.feedback,exact:true}).count(),0,"authored references never fabricate sample feedback");
      await page.screenshot({path:path.join(output,`${locale}-application-result.png`),fullPage:true});
      const data=await overview.getUnderstandingOverview(user.id,course.id);assert.equal(data.total,4);assert.equal(data.completed,2);assert.equal(data.lessons[0].application.latestResult,null);assert.equal(data.lessons[1].knowledge.total,8);
      await mount({view:'overview',key:'overview',locale,courseId:course.id,courseTitle:course.title,category:'Science',backHref:`/${locale}/account/learn/${course.id}`,data});
      assert.equal(await page.locator(`[data-lesson-id="${second.id}"] [data-assessment-kind] button`).count(),2,"both authored Lesson 2 tests unlock after Lesson 1 tests complete");
      await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(output,`${locale}-understanding-mobile.png`),fullPage:true});
      assert.deepEqual(errors,[]);await page.close();
    }
  }finally{await browser.close();await restore();}
});

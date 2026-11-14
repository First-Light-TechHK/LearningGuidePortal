import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { getMessages } from "../../lib/i18n/messages";
import { resolveLessonEntry } from "../../services/lessonEntryPolicy";
import type { LessonBookmarkSnapshot } from "../../contracts/lesson-bookmark";

test("entitled Lesson restores video and paragraph positions while hiding video position labels and retaining text labels", async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PreviewLessonView} from './components/portal/PreviewLessonView';import {LearningRoom} from './components/portal/LearningRoom';import {getMessages} from './lib/i18n/messages';const root=createRoot(document.getElementById('root'));window.mount=props=>flushSync(()=>root.render(props.room?<LearningRoom key={props.key} {...props} copy={getMessages(props.locale).learning}/>:<PreviewLessonView key={props.key} {...props}/>));` },
    bundle: true, write: false, outfile: "progress.js", platform: "browser", jsx: "automatic", loader: { ".css": "local-css" }, external: ["/portal/*"],
    plugins: [{ name: "next", setup(b) {
      b.onResolve({ filter: /Course(Model|Pdf)Preview$/ }, args => ({ path: args.path, namespace: "mock" }));
      b.onResolve({ filter: /^next\// }, args => ({ path: args.path, namespace: "mock" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, a => ({ loader: "tsx", resolveDir: process.cwd(), contents:
        a.path.endsWith("Preview") ? "export const CourseModelPreview=()=>null;export const CoursePdfPreview=()=>null"
          : a.path === "next/navigation" ? "export const useRouter=()=>({refresh(){},push(url){window.destination=url}})"
          : a.path === "next/dynamic" ? "export default ()=>()=>null"
          : "import React from 'react';export default function Component({prefetch,unoptimized,...props}){return props.src?<img {...props}/>:<a {...props}/>}" }));
    } }],
  });
  const browser = await chromium.launch();
  try { for (const locale of ["en-GB", "zh-CN"] as const) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const writes: any[] = [];
    await page.route("http://progress.test/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/api/study/bookmarks") {
        const input = route.request().postDataJSON(); writes.push(input);
        return route.fulfill({ json: { ok: true, data: { ...input, revision: input.expectedRevision + 1, updatedAt: new Date().toISOString(), lpNumber: input.mode === "video" && input.positionMs >= 30_000 ? "1.2" : "1.1" } } });
      }
      if (pathname.includes("learning-mode")) return route.fulfill({json:{ok:true,data:{courseId:"course",mode:route.request().postDataJSON().mode,position:{lessonId:"lesson",contentId:"t1"}}}});
      if (pathname.startsWith("/api/")) return route.fulfill({json:{ok:true,record:{}}});
      if (pathname.startsWith("/portal/")) return route.fulfill({ body: await readFile(path.join("public", pathname)), contentType: pathname.endsWith(".svg") ? "image/svg+xml" : "image/jpeg" });
      if (pathname.endsWith(".mp4")) return route.fulfill({status:404,body:""});
      return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    });
    await page.goto("http://progress.test");
    for (const file of ["app/styles.css", "app/portal-design.css"]) await page.addStyleTag({ content: await readFile(file, "utf8") });
    await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith("css"))!.text});
    await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith("js"))!.text});
    const contents = [
      {id:"v1",type:"video",title:"First video LP",mode:"lecture",url:"/video.mp4",startSeconds:10,nodes:[]},
      {id:"v2",type:"video",title:"Second video LP",mode:"lecture",url:"/video.mp4",startSeconds:30,nodes:[]},
      {id:"t1",type:"text",title:"Reading",mode:"lecture",html:Array.from({length:60},(_,i)=>`<p>Paragraph ${i}. Reading resumes at the same paragraph across devices and display widths.</p>`).join(""),exhibitMode:"authored",nodes:[]},
    ];
    const bookmarkSnapshot: LessonBookmarkSnapshot = {versions:{lesson:{video:"v",text:"t"}},bookmarks:{lesson:{
      video:{mode:"video",contentId:"v2",positionMs:45555,contentVersion:"v",revision:1,clientEventId:"previous-video",updatedAt:"2026-01-02T00:00:00Z",lpNumber:"1.2"},
      text:{mode:"text",contentId:"t1",paragraphId:"t1:paragraph:15",contentVersion:"t",revision:1,clientEventId:"previous-text",updatedAt:"2026-01-01T00:00:00Z",lpNumber:"1.1"},
    }}};
    const props={key:"lesson",locale,courseId:"course",courseTitle:"Course",category:"Science",description:"",lesson:{id:"lesson",title:"Lesson",durationMinutes:10,body:"",contents},outline:[{id:"lesson",number:"01",title:"Lesson",href:"/lesson",modes:["video","text"]}],poster:"",entitled:true,bookmarkRestore:"lp",initialCompleted:false,nextHref:null,preferredMode:"video",initialContentId:"v2",bookmarkSnapshot,bookmarkOwnerId:"owner"};
    await page.evaluate(props=>(window as any).mount(props),props);
    await page.locator("video").evaluate(element=>{Object.defineProperty(element,"duration",{configurable:true,value:100});Object.defineProperty(element,"readyState",{configurable:true,value:4});element.dispatchEvent(new Event("loadedmetadata"));});
    await page.waitForFunction(()=>Math.abs(document.querySelector('video')!.currentTime-45.555)<.001);
    assert.equal(await page.locator('[data-lesson-bookmark]').count(),0,"saved video positions do not add a sidebar label");
    assert.equal(await page.getByText(getMessages(locale).lessonBookmark.video.replace("{lp}","1.2"),{exact:true}).count(),0);
    const select=page.getByRole('combobox',{name:getMessages(locale).previewVideoDesign.learningMode});
    await select.click();await page.getByTitle(getMessages(locale).previewVideoDesign.textMode,{exact:true}).last().click();
    const paragraph=page.locator('[data-text-point-id="t1"]');
    await paragraph.waitFor();
    await page.waitForFunction(()=>{const p=document.querySelector('[data-text-point-id="t1"]');return p&&Math.abs(p.getBoundingClientRect().top-12)<3;});
    await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
    await page.waitForFunction(expected=>document.querySelector('[data-lesson-bookmark]')?.textContent===expected,getMessages(locale).lessonBookmark.text.replace("{lp}","1.1"));
    assert.equal(writes.at(-1).paragraphId,"t1:paragraph:0");
    assert.equal(await page.locator('[data-lesson-bookmark]').count(),1);
    await mkdir('test-results/lesson-bookmarks',{recursive:true});
    await page.screenshot({path:`test-results/lesson-bookmarks/${locale}-text-desktop.png`});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:`test-results/lesson-bookmarks/${locale}-text-mobile.png`});
    const reviewEntry = resolveLessonEntry({lessonId:'lesson',snapshot:bookmarkSnapshot,completed:true,courseMode:'text'});
    await page.evaluate(props=>(window as any).mount(props),{...props,...reviewEntry,key:'completed-reentry',initialCompleted:true});
    await page.locator('video').evaluate(element=>{Object.defineProperty(element,'duration',{configurable:true,value:100});Object.defineProperty(element,'readyState',{configurable:true,value:4});element.dispatchEvent(new Event('loadedmetadata'));});
    await page.waitForFunction(()=>Math.abs(document.querySelector('video')!.currentTime-45.555)<.001);
    assert.equal(await page.locator('video').getAttribute('data-bookmark-content-id'),'v2');
    assert.equal(await page.locator('[data-lesson-bookmark]').count(),0,"completed re-entry also omits the video position label");
    const checkpoint = page.waitForResponse(response=>response.url().endsWith('/api/study/bookmarks')&&response.request().postDataJSON()?.positionMs===50_555);
    await page.locator('video').evaluate(element=>{(element as HTMLVideoElement).currentTime=50.555;element.dispatchEvent(new Event('timeupdate'));element.dispatchEvent(new Event('pause'));});
    const savedReview = (await (await checkpoint).json()).data;
    const reviewSnapshot = {...bookmarkSnapshot,bookmarks:{lesson:{...bookmarkSnapshot.bookmarks.lesson,video:savedReview}}};
    const reentry = resolveLessonEntry({lessonId:'lesson',snapshot:reviewSnapshot,completed:true,courseMode:'text'});
    await page.evaluate(props=>(window as any).mount(props),{...props,...reentry,key:'completed-saved-reentry',initialCompleted:true,bookmarkSnapshot:reviewSnapshot});
    await page.locator('video').evaluate(element=>{Object.defineProperty(element,'duration',{configurable:true,value:100});Object.defineProperty(element,'readyState',{configurable:true,value:4});element.dispatchEvent(new Event('loadedmetadata'));});
    await page.waitForFunction(()=>Math.abs(document.querySelector('video')!.currentTime-50.555)<.001);
    assert.equal(await page.locator('video').getAttribute('data-bookmark-content-id'),'v2');
    await page.close();
  }} finally { await browser.close(); }
});

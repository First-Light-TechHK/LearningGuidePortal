import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import type { LessonBookmarkSnapshot } from "../../contracts/lesson-bookmark";
import { resolveLessonEntry } from "../../services/lessonEntryPolicy";

test("both locale directions reload the same Lesson and current mode checkpoint, including completed review", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{useRef} from 'react';import {createRoot} from 'react-dom/client';import {PortalLanguageLink} from './components/portal/PortalLanguageLink';import {useLessonBookmarks} from './components/portal/useLessonBookmarks';
    function App(){const p=window.fixture,root=useRef(null);useLessonBookmarks({root,courseId:'course',lessonId:'lesson',mode:p.mode,enabled:true,ownerId:'owner',initial:p.snapshot,contents:[],restorePolicy:p.policy,onRestoreContent:()=>{}});
    return <><header className="portal-header" style={{position:'fixed',top:0,left:0,right:0,height:48,zIndex:10,background:'white'}}><PortalLanguageLink locale={location.pathname.startsWith('/en-GB')?'en-GB':'zh-CN'} label="Language"/></header><div ref={root} style={{paddingTop:80}} data-current-mode={p.mode}>{p.mode==='video'?<video className="la-lesson-video" data-bookmark-content-id="v1"/>:<div data-text-reader data-bookmark-ready="true" style={{overflowY:'visible'}}>{['t1','t2'].map(id=><section key={id} data-text-point-id={id}><h2>{id}</h2><div className="la-prose">{Array.from({length:20},(_,i)=><p key={i} data-paragraph={id+':'+i} style={{height:60,margin:0}}>Paragraph {i}</p>)}</div></section>)}</div>}</div></>};createRoot(document.getElementById('root')).render(<App/>);` },
    bundle: true, write: false, platform: "browser", jsx: "automatic", plugins: [{ name: "next", setup(b) {
      b.onResolve({ filter: /^next\// }, a => ({ path: a.path, namespace: "next" }));
      b.onLoad({ filter: /.*/, namespace: "next" }, a => ({ resolveDir: process.cwd(), loader: "tsx", contents: a.path === "next/navigation"
        ? "export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search)"
        : "import React from 'react';export default function Link({prefetch,...p}){return <a {...p}/>;}" }));
    } }] });
  const browser = await chromium.launch();
  try { for(const locale of ["en-GB","zh-CN"]) for(const mode of ["video","text"] as const) for(const completed of [false,true]) for(const path of ["/account/learn/course","/portal/courses/course/public-lesson"]) {
    let snapshot: LessonBookmarkSnapshot = { versions:{lesson:{video:"v",text:"t"}}, bookmarks:{lesson:{
      video:{mode:"video",contentId:"v1",positionMs:11111,contentVersion:"v",revision:1,clientEventId:"old-v",lpNumber:"1.1",updatedAt:"2026-01-01"},
      text:{mode:"text",contentId:"t1",paragraphId:"t1:paragraph:0",contentVersion:"t",revision:1,clientEventId:"old-t",lpNumber:"1.1",updatedAt:"2026-01-01"},
    }} };
    const page=await browser.newPage({viewport:{width:900,height:600}});
    await page.route("http://resume.test/**",async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==="/api/me/locale") return route.fulfill({json:{ok:true}});
      if(url.pathname==="/api/study/bookmarks"){
        const input=route.request().postDataJSON();await new Promise(resolve=>setTimeout(resolve,40));
        const value={...input,revision:input.expectedRevision+1,updatedAt:new Date().toISOString(),lpNumber:input.contentId==='t2'?'1.2':'1.1'};
        snapshot={...snapshot,bookmarks:{lesson:{...snapshot.bookmarks.lesson,[input.mode]:value}}};
        return route.fulfill({json:{ok:true,data:value}});
      }
      let selectedMode: "video"|"text"=mode,policy=completed?'start':'position';
      if(url.searchParams.get('resume')==='1'){
        // A later write in another tab/mode must not change this tab's current presentation.
        const other=mode==='video'?'text':'video';snapshot.bookmarks.lesson[other]!.updatedAt='2099-01-01';
        const entry=resolveLessonEntry({lessonId:'lesson',snapshot,completed,courseMode:other,languageContinuation:true,requestedMode:url.searchParams.get('viewMode') as 'video'|'text'});
        selectedMode=entry.preferredMode!;policy=entry.bookmarkRestore;
      }
      return route.fulfill({contentType:'text/html',body:`<div id="root"></div><script>window.fixture=${JSON.stringify({mode:selectedMode,policy,snapshot})}</script>`});
    });
    await page.goto(`http://resume.test/${locale}${path}?lessonId=lesson&viewMode=${mode==='video'?'text':'video'}`);
    const mount=async()=>{await page.addScriptTag({content:bundle.outputFiles[0].text});await page.locator('[data-current-mode]').waitFor();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));};
    await mount();
    if(mode==='video') await page.locator('video').evaluate(video=>{Object.defineProperty(video,'duration',{configurable:true,value:200});Object.defineProperty(video,'readyState',{configurable:true,value:4});video.dispatchEvent(new Event('loadedmetadata'));(video as HTMLVideoElement).currentTime=57.123;});
    else await page.locator('[data-paragraph="t2:3"]').evaluate(element=>window.scrollTo(0,element.getBoundingClientRect().top+scrollY-60));
    await page.locator('.portal-language').click();
    await page.waitForURL(url=>url.searchParams.get('resume')==='1');
    assert.equal(new URL(page.url()).searchParams.get('viewMode'),mode);
    assert.equal(new URL(page.url()).searchParams.get('lessonId'),'lesson');
    await mount();assert.equal(await page.locator('[data-current-mode]').getAttribute('data-current-mode'),mode);
    if(mode==='video'){
      await page.locator('video').evaluate(video=>{Object.defineProperty(video,'duration',{configurable:true,value:200});Object.defineProperty(video,'readyState',{configurable:true,value:4});video.dispatchEvent(new Event('loadedmetadata'));});
      assert.ok(Math.abs(await page.locator('video').evaluate(video=>(video as HTMLVideoElement).currentTime)-57.123)<.001,'locale reload retains exact milliseconds');
    }else await page.waitForFunction(()=>Math.abs(document.querySelector('[data-text-point-id="t2"]')!.getBoundingClientRect().top-60)<3);
    await page.close();
  }} finally { await browser.close(); }
});

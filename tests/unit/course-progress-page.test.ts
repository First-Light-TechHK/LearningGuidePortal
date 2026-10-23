import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { getMessages } from "../../lib/i18n/messages";

test("text points share continuous anchors, track scroll and resume, and preserve Next Lesson completion", async () => {
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const requests: any[] = []; let failNext = true, hold = true, release: (() => void) | undefined;
    await page.route("http://progress.test/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.startsWith("/api/study/")) {
        const body = route.request().postDataJSON(); requests.push(body);
        if (body.completeLesson) {
          if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { error: "unavailable" } }); }
          if (hold) await new Promise<void>(resolve => { release = resolve; });
        }
        return route.fulfill({ json: { record: { progress: body.completeLesson ? 60 : 20 } } });
      }
      if (pathname.startsWith("/portal/")) return route.fulfill({ body: await readFile(path.join("public", pathname)), contentType: pathname.endsWith("svg") ? "image/svg+xml" : "image/png" });
      if (pathname.endsWith("mp4")) return route.fulfill({ status: 404 });
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><div id="root"></div>' });
    });
    await page.goto("http://progress.test/");
    for (const file of ["app/styles.css", "app/portal-design.css"]) await page.addStyleTag({ content: await readFile(file, "utf8") });
    await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith("css"))!.text });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith("js"))!.text });
    const contents = [1, 2, 3].map(index => ({ id: `t${index}`, type: "text", title: `Reading ${index}`, mode: "lecture", html: Array.from({length:18}, (_, paragraph) => `<p>Text ${index}, paragraph ${paragraph + 1}. Read the chapter continuously and follow the outline as you scroll.</p>`).join(""), exhibitMode: "authored", nodes: [] })).concat([1, 2].map(index => ({ id: `v${index}`, type: "video", title: `Video ${index}`, mode: "lecture", url: `/video-${index}.mp4`, nodes: [] })) as any);
    const mount = (key: string, mode = "text") => page.evaluate(props => { delete (window as any).destination; (window as any).mount(props); }, { key, locale, courseId: "course", courseTitle: "Course", category: "Science", description: "", lesson: { id: "lesson", title: "Lesson", durationMinutes: 2, body: "", contents }, outline: [{ id: "lesson", title: "Lesson", number: "01", modes: ["text", "video"], href: "/lesson" }], preferredMode: mode, entitled: true, initialCompleted: false, poster: "", studyEndpoint: "/api/study/events", nextHref: "/next" });
    const waitFor = (predicate: (body: any) => boolean) => page.waitForResponse(response => response.url().endsWith("/api/study/events") && predicate(response.request().postDataJSON()));
    await Promise.all([waitFor(body => body.contentId === "t1"), mount("text")]);
    assert.equal(requests[0].event, "open"); assert.equal(requests[0].learningMode, "text");
    const reader = page.locator("[data-text-reader]");
    await page.locator('[data-text-point-id="t3"] .la-prose').first().waitFor();
    assert.equal(await reader.locator("[data-text-point-id]").count(), 3, "all text points share the same reading surface");
    await reader.evaluate(element => { element.dataset.identity = "persistent-reader"; });
    await Promise.all([waitFor(body => body.contentId === "t3"), reader.evaluate(element => { element.scrollTop = element.scrollHeight; })]);
    await page.waitForFunction(() => document.querySelector('button[aria-current="step"]')?.textContent?.includes("Reading 3"));
    await Promise.all([waitFor(body => body.contentId === "t2"), reader.evaluate(element => {
      const target = element.querySelector('[data-text-point-id="t2"]')!;
      element.scrollTop += target.getBoundingClientRect().top - element.getBoundingClientRect().top - 12;
    })]);
    await page.waitForFunction(() => document.querySelector('button[aria-current="step"]')?.textContent?.includes("Reading 2"));
    await Promise.all([waitFor(body => body.contentId === "t1"), reader.evaluate(element => { element.scrollTop = 0; })]);

    assert.equal(await page.getByRole("button", { name: getMessages(locale).learning.completeLesson, exact: true }).count(), 0, "text lessons do not offer manual completion");
    await Promise.all([waitFor(body => body.contentId === "t3"), page.getByRole("button", { name: "1.3 Reading 3", exact: true }).click()]);
    await Promise.all([waitFor(body => body.contentId === "t1"), page.getByRole("button", { name: "1.1 Reading 1", exact: true }).click()]);
    assert.equal(await reader.getAttribute("data-identity"), "persistent-reader", "outline jumps preserve the reader and mounted content");
    assert.equal(await reader.locator("[data-text-point-id]").count(), 3);
    await reader.evaluate(element => { element.scrollTop = 100; });
    await page.getByRole("button", { name: "1.1 Reading 1", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-text-reader]")!.scrollTop === 0);
    await mkdir("test-results/text-completion", {recursive:true});
    await reader.evaluate(element => { const target = element.querySelector('[data-text-point-id="t2"]')!; element.scrollTop += target.getBoundingClientRect().top - element.getBoundingClientRect().top - 160; });
    await page.screenshot({path:`test-results/text-completion/${locale}-continuous-desktop.png`,fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.getByRole("button", {name:"1.2 Reading 2",exact:true}).click();
    await page.waitForFunction(() => document.querySelector('button[aria-current="step"]')?.textContent?.includes("Reading 2"));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
    await page.screenshot({path:`test-results/text-completion/${locale}-continuous-mobile.png`,fullPage:true});
    await page.setViewportSize({width:1440,height:1100});
    await page.getByRole("button", {name:"1.1 Reading 1",exact:true}).click();
    const next = page.getByRole("button", { name: getMessages(locale).learning.nextLesson , exact: true });
    await next.click(); await page.getByRole("alert").waitFor();
    assert.equal(await page.evaluate(() => (window as any).destination), undefined, "failed completion cannot navigate");
    assert.equal(await page.getByRole("dialog").count(),0);
    assert.equal(await page.getByRole("status",{name:getMessages(locale).videoCompletion.label}).count(),0);
    await Promise.all([page.waitForRequest(request=>request.url().endsWith('/api/study/events')&&request.postDataJSON()?.completeLesson), next.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); })]);
    for (let count = 0; !release && count < 100; count++) await page.waitForTimeout(10);
    assert.equal(requests.filter(body => body.completeLesson).length, 2, "failed request plus one retry, never duplicate in-flight writes");
    assert.deepEqual(requests.filter(body => body.completeLesson)[0], requests.filter(body => body.completeLesson)[1], "retry reuses the persisted event identity");
    assert.equal(await page.evaluate(() => (window as any).destination), undefined, "navigation waits for successful save");
    assert.equal(await page.getByRole("dialog").count(),0,"completion cannot appear before the save succeeds");
    release!();hold=false;await page.getByRole("dialog").waitFor();
    assert.equal(await page.evaluate(() => (window as any).destination),undefined,"successful save opens the dialog before navigation");
    assert.equal(await page.getByRole("status",{name:getMessages(locale).videoCompletion.label}).count(),0,"text completion has no inline progress or completion status");
    assert.equal(requests.filter(body=>body.completeLesson).at(-1).learningMode,"text");
    assert.equal(requests.filter(body=>body.completeLesson).at(-1).progress,undefined,"client never forces the course progress to 100");
    await mkdir('test-results/text-completion',{recursive:true});
    await page.screenshot({path:`test-results/text-completion/${locale}-completed.png`,fullPage:true});
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => (window as any).destination),undefined);
    await next.click();await page.getByRole("dialog").waitFor();
    assert.equal(requests.filter(body=>body.completeLesson).length,2,"reopening a saved completion does not write again");
    await page.getByRole("dialog").getByRole("button",{name:getMessages(locale).lessonCompleted.nextLesson,exact:true}).click();
    await page.waitForFunction(() => (window as any).destination === "/next");
    for(const room of [false,true])for(const type of ["text","pdf","legacy"]){
      await page.evaluate(props=>{delete (window as any).destination;(window as any).mount(props);},{key:`${room}-${type}`,room,locale,entitled:true,courseId:"course",courseTitle:"Course",category:"Science",description:"",lesson:{id:"lesson",title:"Lesson",durationMinutes:2,body:"Legacy reading",contents:type==="legacy"?undefined:[{id:"reading",type,title:"Reading",mode:"lecture",html:"<p>Text content</p>",url:"/reading.pdf",nodes:[]}]},outline:[{id:"lesson",title:"Lesson",number:"01",href:"/lesson"}],initialCompleted:false,poster:"",nextHref:null});
      assert.equal(await page.getByRole("button",{name:getMessages(locale).learning.completeLesson,exact:true}).count(),0);
      await page.getByRole("button",{name:getMessages(locale).learning.nextLesson,exact:true}).click();await page.getByRole("dialog").waitFor();
      assert.equal(await page.getByRole("status",{name:getMessages(locale).videoCompletion.label}).count(),0,"text completion has no inline progress or completion status");
      if(type==="text"&&!room){await page.setViewportSize({width:390,height:844});await page.screenshot({path:`test-results/text-completion/${locale}-mobile.png`,fullPage:true});assert.equal(await page.getByRole("dialog").evaluate(e=>e.getBoundingClientRect().right>innerWidth),false);await page.setViewportSize({width:1440,height:1100});}
      await page.getByRole("dialog").getByRole("button",{name:getMessages(locale).lessonCompleted.nextLesson,exact:true}).click();
      await page.waitForFunction(expected=>(window as any).destination===expected,`/${locale}/account/my-learning`);
    }
    const restoredProps={key:"restored",locale,entitled:true,courseId:"course",courseTitle:"Course",category:"Science",description:"",lesson:{id:"lesson",title:"Lesson",durationMinutes:2,body:"",contents:[{id:"reading",type:"text",title:"Reading",mode:"lecture",html:"<p>Saved text</p>",nodes:[]}]},outline:[{id:"lesson",title:"Lesson",number:"01",href:"/lesson"}],initialCompleted:true,completedContentIds:["reading"],poster:"",nextHref:"/next"};
    await page.evaluate(props=>(window as any).mount(props),restoredProps);
    assert.equal(await page.getByRole("status",{name:getMessages(locale).videoCompletion.label}).count(),0,"text completion has no inline progress or completion status");
    await page.evaluate(props=>(window as any).mount(props),{...restoredProps,key:"video-complete-only",completedContentIds:["video"]});
    assert.equal(await page.getByRole("status",{name:getMessages(locale).videoCompletion.label}).count(),0,"video completion cannot complete text");
    await page.evaluate(props=>(window as any).mount(props),{...restoredProps,key:"preview",entitled:false});
    assert.equal(await page.getByRole("button",{name:getMessages(locale).learning.nextLesson,exact:true}).count(),0,"unentitled previews cannot complete text");
    assert.equal(await page.getByRole("status",{name:getMessages(locale).videoCompletion.label}).count(),0);
    await page.evaluate(props => (window as any).mount(props), {...restoredProps, key:"resume-middle", initialContentId:"t2", lesson:{...restoredProps.lesson,contents}});
    await page.locator('[data-text-point-id="t2"] .la-prose').first().waitFor();
    await page.waitForFunction(() => {
      const reader = document.querySelector("[data-text-reader]")!, point = reader.querySelector('[data-text-point-id="t2"]')!;
      return Math.abs(point.getBoundingClientRect().top - reader.getBoundingClientRect().top - 12) < 2;
    }, undefined, {timeout:3000}).catch(async error => {
      throw new Error(JSON.stringify(await page.evaluate(() => {
        const reader = document.querySelector("[data-text-reader]")!;
        return {scrollTop:reader.scrollTop,scrollHeight:reader.scrollHeight,height:reader.clientHeight,top:reader.getBoundingClientRect().top,current:document.querySelector('button[aria-current="step"]')?.textContent,sections:Array.from(reader.querySelectorAll('[data-text-point-id]')).map(e=>({id:e.getAttribute('data-text-point-id'),top:e.getBoundingClientRect().top,height:e.getBoundingClientRect().height,ready:e.querySelector('[data-text-ready]')?.getAttribute('data-text-ready')}))};
      })), {cause:error});
    });
    assert.match(await page.locator('button[aria-current="step"]').textContent() || "", /Reading 2/);
    const beforeVideo = requests.length; await mount("video", "video"); await page.locator("video").waitFor();
    await page.locator("video").evaluate(video => { video.dispatchEvent(new Event("loadedmetadata")); video.dispatchEvent(new Event("timeupdate")); });
    await page.waitForTimeout(100); assert.equal(requests.length, beforeVideo, "metadata alone does not save video progress");
    await Promise.all([waitFor(body => body.contentId === "v1"), page.locator("video").evaluate(video => video.dispatchEvent(new Event("play")))]);
    const afterPlay = requests.length;
    await page.locator("video").evaluate(video => { for (let i = 0; i < 10; i++) { video.dispatchEvent(new Event("play")); video.dispatchEvent(new Event("timeupdate")); } });
    await page.waitForTimeout(100); assert.equal(requests.length, afterPlay, "repeated playback ticks do not save the same point repeatedly");
    await page.getByRole("button", { name: "1.2 Video 2", exact: true }).click();
    await page.waitForTimeout(100); assert.equal(requests.length, afterPlay);
    await Promise.all([waitFor(body => body.contentId === "v2"), page.locator("video").evaluate(video => video.dispatchEvent(new Event("play")))]);
    assert.equal(requests.at(-1).learningMode, "video");
    await page.close();
  } } finally { await browser.close(); }
});

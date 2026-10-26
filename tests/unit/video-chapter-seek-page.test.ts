import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

test("video point selection plays real media across same/different sources while preserving chapter starts and trial limits", {timeout:120000}, async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PreviewLessonView} from './components/portal/PreviewLessonView';import {LessonContentPlayer} from './components/portal/LessonContentPlayer';const root=createRoot(document.getElementById('root'));window.mount=p=>flushSync(()=>root.render(p.player?<LessonContentPlayer key={p.key} contents={p.lesson.contents} initialContentId={p.initialContentId} locale={p.locale}/>:<PreviewLessonView key={p.key} {...p}/>));`,
    },
    bundle: true,
    write: false,
    outfile: "chapter.js",
    platform: "browser",
    jsx: "automatic",
    external: ["/portal/*"],
    loader: { ".css": "local-css" },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{
      name: "next",
      setup(builder) {
        builder.onResolve({ filter: /Course(Model|Pdf)Preview$/ }, args => ({ path: args.path, namespace: "mock" }));
        builder.onResolve({ filter: /^next\// }, args => ({ path: args.path, namespace: "mock" }));
        builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({
          resolveDir: process.cwd(),
          loader: "tsx",
          contents: args.path.endsWith("Preview")
            ? "export const CourseModelPreview=()=>null;export const CoursePdfPreview=()=>null"
            : args.path === "next/navigation"
              ? "export const useRouter=()=>({refresh(){},push(href){window.destination=href}})"
              : args.path === "next/dynamic"
                ? "export default ()=>()=>null"
                : args.path === "next/link"
                  ? "import React from 'react';export default function Link({prefetch,...p}){return <a {...p}/>}"
                  : "import React from 'react';export default function Image({unoptimized,fill,...p}){return <img {...p}/>}",
        }));
      },
    }],
  });
  const browser = await chromium.launch();
  try {
    for (const locale of ["en-GB", "zh-CN"] as const) for (const player of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith(".webm")) {
          const body=await readFile(`public${url.pathname}`),range=route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
          const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),body.length-1):body.length-1;
          return route.fulfill({status:range?206:200,body:body.subarray(start,end+1),contentType:"video/webm",headers:{"Accept-Ranges":"bytes",...(range?{"Content-Range":`bytes ${start}-${end}/${body.length}`}:{})}});
        }
        if (url.pathname.startsWith("/portal/")) return route.fulfill({ body: await readFile(`public${url.pathname}`), contentType: url.pathname.endsWith(".svg") ? "image/svg+xml" : "image/png" });
        if (url.pathname.startsWith("/api/")) return route.fulfill({ json: { record: {} } });
        return route.fulfill({ contentType: "text/html", body: "<!doctype html><div id='root'></div>" });
      });
      await page.goto("http://chapter.test");
      await page.addScriptTag({ content: "window.__name=value=>value" });
      for (const file of ["app/styles.css", "app/portal-design.css", "components/portal/lesson-authoring.css"]) await page.addStyleTag({ content: await readFile(file, "utf8") });
      await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith("css"))!.text});
      await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith("js"))!.text });
      const lesson = {
        id: "lesson", title: "Modeling", body: "", durationMinutes: 1,
        contents: [
          { id: "v1", title: "State Spaces", type: "video", mode: "lecture", exhibitMode: "authored", url: "/portal/text-exhibits/flowers.webm", startSeconds: 0, nodes: [] },
          { id: "v2", title: "Defining Vectors", type: "video", mode: "lecture", exhibitMode: "authored", url: "/portal/text-exhibits/flowers.webm", startSeconds: 0.5, nodes: [] },
          { id: "v3", title: "Other source", type: "video", mode: "lecture", exhibitMode: "authored", url: "/portal/text-exhibits/flowers.webm?source=other", startSeconds: 0.25, nodes: [] },
        ],
      };
      const props = { player, key:"video", locale, courseId:"modeling-life", courseTitle:"Modeling life", category:"Science", description:"", poster:"/portal/course-study.jpg", lesson, outline:[{id:"lesson",number:"01",title:lesson.title,href:"/lesson",modes:["video"]}],nextHref:null,initialCompleted:false,entitled:true,preferredMode:"video" };
      const mount = (extra: object = {}) => page.evaluate(props => (window as unknown as { mount:(p:unknown)=>void }).mount(props), {...props,...extra});
      const video = page.locator("video.la-lesson-video");
      const point = (index: number) => player ? page.locator(".la-content-nav button").nth(index) : page.getByRole("button", { name: new RegExp(`^1\\.${index + 1} `) });
      const ready = () => page.waitForFunction(() => document.querySelector<HTMLVideoElement>("video.la-lesson-video")!.readyState >= 2);
      const playing = () => page.waitForFunction(() => { const media=document.querySelector<HTMLVideoElement>("video.la-lesson-video");return media && !media.paused && !media.ended && media.readyState>=2; });
      await mount();await ready();
      assert.equal(await video.evaluate(el=>(el as HTMLVideoElement).currentTime),0,"first entry starts at zero without starting playback");
      assert.equal(await video.evaluate(el=>(el as HTMLVideoElement).paused),true);
      await video.evaluate(el=>{el.setAttribute("data-identity","same-video");(el as HTMLVideoElement).loop=true;});
      const openedPoint=!player?page.waitForRequest(request=>request.url().includes("/api/study/")&&request.postDataJSON()?.contentId==="v2"):undefined;
      await point(1).click();await playing();await openedPoint;
      assert.equal(await video.getAttribute("data-identity"),"same-video","same-source navigation retains the video element");
      assert.ok(await video.evaluate(el=>(el as HTMLVideoElement).currentTime>=0.5));
      const before = await video.evaluate(el=>(el as HTMLVideoElement).currentTime);
      await page.waitForFunction(before=>document.querySelector<HTMLVideoElement>("video.la-lesson-video")!.currentTime>before+0.05,before);
      await video.evaluate(el=>{(el as HTMLVideoElement).playbackRate=1.5;(el as HTMLVideoElement).muted=true;});
      await point(0).click();await playing();
      assert.equal(await video.getAttribute("data-identity"),"same-video");
      assert.equal(await video.evaluate(el=>(el as HTMLVideoElement).playbackRate),1.5);
      assert.equal(await video.evaluate(el=>(el as HTMLVideoElement).muted),true);
      await video.evaluate(el=>(el as HTMLVideoElement).pause());
      await point(0).click();await playing();
      assert.ok(await video.evaluate(el=>(el as HTMLVideoElement).currentTime<0.5),"reselecting the same paused point restarts and plays it");
      // A real seek can interrupt the first play promise; the seeked/canplay retry must recover.
      await video.evaluate(el=>{
        const media=el as HTMLVideoElement, nativePlay=media.play.bind(media);
        media.pause();let attempts=0;
        media.play=()=>{media.dataset.playAttempts=String(++attempts);return attempts===1?Promise.reject(new DOMException("Seek interrupted playback","AbortError")):nativePlay();};
      });
      await point(1).click();await playing();
      assert.ok(Number(await video.getAttribute("data-play-attempts"))>=2,"an interrupted chapter play is retried after the actual media seek");
      const openedSource=!player?page.waitForRequest(request=>request.url().includes("/api/study/")&&request.postDataJSON()?.contentId==="v3"):undefined;
      await point(2).click();await ready();await playing();await openedSource;
      assert.equal(await video.getAttribute("data-identity"),null,"a different source gets a new video which also plays");
      assert.ok(await video.evaluate(el=>(el as HTMLVideoElement).currentTime>=0.25));
      // Resuming a selected later point retains its authored position without unsolicited autoplay.
      await mount({key:"resume",initialContentId:"v2"});await ready();
      assert.equal(await video.evaluate(el=>(el as HTMLVideoElement).currentTime),0.5);
      assert.equal(await video.evaluate(el=>(el as HTMLVideoElement).paused),true);
      if (!player) {
        await mount({key:"trial",entitled:false,trialGate:{pricingHref:"/subscription",recommendations:[],videoLimitSeconds:0.1}});await ready();
        await point(1).click();await page.getByRole("dialog").waitFor();
        assert.equal(await video.evaluate(el=>(el as HTMLVideoElement).paused),true);
        assert.equal(await video.evaluate(el=>(el as HTMLVideoElement).currentTime),0.1,"selecting beyond the preview cutoff cannot resume playback");
      }
      assert.deepEqual(errors,[]);
      await page.close();
    }
  } finally { await browser.close(); }
});

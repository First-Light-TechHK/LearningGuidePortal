import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getMessages } from "../../lib/i18n/messages";

test("text entry/selection and video playback save points; Next Lesson saves the whole outline before navigation", async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PreviewLessonView} from './components/portal/PreviewLessonView';const root=createRoot(document.getElementById('root'));window.mount=props=>flushSync(()=>root.render(<PreviewLessonView key={props.key} {...props}/>));` },
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
  const browser = await chromium.launch({ channel: "msedge" });
  try { for (const locale of ["en-GB", "zh-CN"] as const) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const requests: any[] = []; let failNext = true, release: (() => void) | undefined;
    await page.route("http://progress.test/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.startsWith("/api/study/")) {
        const body = route.request().postDataJSON(); requests.push(body);
        if (body.completeLesson) {
          if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { error: "unavailable" } }); }
          await new Promise<void>(resolve => { release = resolve; });
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
    const contents = [1, 2, 3].map(index => ({ id: `t${index}`, type: "text", title: `Reading ${index}`, mode: "lecture", html: `<p>Text ${index}</p>`, nodes: [] })).concat([1, 2].map(index => ({ id: `v${index}`, type: "video", title: `Video ${index}`, mode: "lecture", url: `/video-${index}.mp4`, nodes: [] })) as any);
    const mount = (key: string, mode = "text") => page.evaluate(props => { delete (window as any).destination; (window as any).mount(props); }, { key, locale, courseId: "course", courseTitle: "Course", category: "Science", description: "", lesson: { id: "lesson", title: "Lesson", durationMinutes: 2, body: "", contents }, outline: [{ id: "lesson", title: "Lesson", number: "01", modes: ["text", "video"], href: "/lesson" }], preferredMode: mode, entitled: true, initialCompleted: false, poster: "", studyEndpoint: "/api/study/events", nextHref: "/next" });
    const waitFor = (predicate: (body: any) => boolean) => page.waitForResponse(response => response.url().endsWith("/api/study/events") && predicate(response.request().postDataJSON()));
    await Promise.all([waitFor(body => body.contentId === "t1"), mount("text")]);
    assert.equal(requests[0].event, "open"); assert.equal(requests[0].learningMode, "text");
    assert.equal(await page.getByRole("button", { name: getMessages(locale).learning.completeLesson, exact: true }).count(), 0, "text lessons do not offer manual completion");
    await Promise.all([waitFor(body => body.contentId === "t3"), page.getByRole("button", { name: "1.3 Reading 3", exact: true }).click()]);
    await Promise.all([waitFor(body => body.contentId === "t1"), page.getByRole("button", { name: "1.1 Reading 1", exact: true }).click()]);
    const next = page.getByRole("button", { name: getMessages(locale).learning.nextLesson + " →", exact: true });
    await next.click(); await page.getByRole("alert").waitFor();
    assert.equal(await page.evaluate(() => (window as any).destination), undefined, "failed completion cannot navigate");
    await Promise.all([page.waitForRequest(request=>request.url().endsWith('/api/study/events')&&request.postDataJSON()?.completeLesson), next.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); })]);
    for (let count = 0; !release && count < 100; count++) await page.waitForTimeout(10);
    assert.equal(requests.filter(body => body.completeLesson).length, 2, "failed request plus one retry, never duplicate in-flight writes");
    assert.deepEqual(requests.filter(body => body.completeLesson)[0], requests.filter(body => body.completeLesson)[1], "retry reuses the persisted event identity");
    assert.equal(await page.evaluate(() => (window as any).destination), undefined, "navigation waits for successful save");
    release!(); await page.waitForFunction(() => (window as any).destination === "/next");
    const beforeVideo = requests.length; await mount("video", "video"); await page.locator("video").waitFor();
    await page.locator("video").evaluate(video => { video.dispatchEvent(new Event("loadedmetadata")); video.dispatchEvent(new Event("timeupdate")); });
    await page.waitForTimeout(100); assert.equal(requests.length, beforeVideo, "metadata alone does not save video progress");
    await Promise.all([waitFor(body => body.contentId === "v1"), page.locator("video").evaluate(video => video.dispatchEvent(new Event("play")))]);
    const afterPlay = requests.length;
    await page.locator("video").evaluate(video => { for (let i = 0; i < 10; i++) { video.dispatchEvent(new Event("play")); video.dispatchEvent(new Event("timeupdate")); } });
    await page.waitForTimeout(100); assert.equal(requests.length, afterPlay, "repeated playback ticks do not save the same point repeatedly");
    await page.getByRole("button", { name: "1.5 Video 2", exact: true }).click();
    await page.waitForTimeout(100); assert.equal(requests.length, afterPlay);
    await Promise.all([waitFor(body => body.contentId === "v2"), page.locator("video").evaluate(video => video.dispatchEvent(new Event("play")))]);
    assert.equal(requests.at(-1).learningMode, "video");
    await page.close();
  } } finally { await browser.close(); }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { getMessages } from "../../lib/i18n/messages";

test("mode switching resumes the last visited point after backward review, with text scroll and paused video seek", { timeout: 120000 }, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PreviewLessonView} from './components/portal/PreviewLessonView';const root=createRoot(document.getElementById('root'));window.mount=p=>{window.currentProps=p;flushSync(()=>root.render(<PreviewLessonView key={p.lesson.id} {...p}/>))};window.navigate=href=>{window.destination=href;const url=new URL(href,location.href);window.mount({...window.currentProps,lesson:window.lessons[url.searchParams.get('lessonId')],preferredMode:url.searchParams.get('viewMode'),initialContentId:url.searchParams.get('contentId')})};` },
    bundle: true, write: false, outfile: "mode-position.js", platform: "browser", jsx: "automatic", external: ["/portal/*"], loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "next", setup(builder) {
      builder.onResolve({ filter: /Course(Model|Pdf)Preview$/ }, args => ({ path: args.path, namespace: "mock" }));
      builder.onResolve({ filter: /^next\// }, args => ({ path: args.path, namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ resolveDir: process.cwd(), loader: "tsx", contents:
        args.path.endsWith("Preview") ? "export const CourseModelPreview=()=>null;export const CoursePdfPreview=()=>null"
        : args.path === "next/navigation" ? "export const useRouter=()=>({refresh(){},push(href){window.navigate(href)}})"
        : args.path === "next/dynamic" ? "export default ()=>()=>null"
        : args.path === "next/link" ? "import React from 'react';export default function Link({prefetch,...p}){return <a {...p}/>}"
        : "import React from 'react';export default function Image({unoptimized,fill,...p}){return <img {...p}/>}" }));
    } }],
  });
  const browser = await chromium.launch();
  await mkdir("test-results/course-mode-position", { recursive: true });
  try {
    for (const locale of ["en-GB", "zh-CN"] as const) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      const positions = { text: { lessonId: "b", contentId: "b-text-2" }, video: { lessonId: "a", contentId: "a-video-2" } };
      const modeRequests: { mode: "text" | "video"; lessonId: string }[] = [];
      let fail = true;
      await page.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith("/learning-mode")) {
          const body = route.request().postDataJSON(); modeRequests.push(body);
          return route.fulfill({ status: fail ? 503 : 200, json: { ok: !fail, data: { courseId: "course", mode: body.mode, position: positions[body.mode as "text" | "video"] } } });
        }
        if (url.pathname.endsWith(".webm")) {
          const body = await readFile(`public${url.pathname}`), range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
          const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
          return route.fulfill({ status: range ? 206 : 200, body: body.subarray(start, end + 1), contentType: "video/webm", headers: { "Accept-Ranges": "bytes", ...(range ? { "Content-Range": `bytes ${start}-${end}/${body.length}` } : {}) } });
        }
        if (url.pathname.startsWith("/portal/")) return route.fulfill({ body: await readFile(`public${url.pathname}`), contentType: url.pathname.endsWith(".svg") ? "image/svg+xml" : "image/png" });
        if (url.pathname.startsWith("/api/")) {
          const body = route.request().postDataJSON();
          if (body?.event === "open" && (body.learningMode === "text" || body.learningMode === "video")) positions[body.learningMode as "text" | "video"] = { lessonId: body.lessonId, contentId: body.contentId };
          return route.fulfill({ json: { record: {} } });
        }
        return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      });
      await page.goto("http://mode-position.test");
      await page.addScriptTag({ content: "window.__name=value=>value" });
      for (const filename of ["app/styles.css", "app/portal-design.css", "components/portal/lesson-authoring.css"]) await page.addStyleTag({ content: await readFile(filename, "utf8") });
      await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith("css"))!.text });
      await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith("js"))!.text });
      const lessons = Object.fromEntries(["a", "b"].map(id => [id, {
        id, title: `Lesson ${id}`, body: "", durationMinutes: 1,
        contents: ["text", "video"].flatMap(type => [1, 2, 3, 4].map(n => ({ id: `${id}-${type}-${n}`, title: `${type} ${n}`, type, mode: "lecture", nodes: [], exhibitMode: "authored", ...(type === "text"
          ? { html: Array.from({ length: 12 }, () => `<p>${id} point ${n}: ${"Reading a course point. ".repeat(25)}</p>`).join("") }
          : { url: "/portal/text-exhibits/flowers.webm", startSeconds: (n - 1) / 2 }) }))),
      }]));
      await page.evaluate(lessons => { (window as any).lessons = lessons; }, lessons);
      await page.evaluate(props => (window as any).mount(props), { locale, courseId: "course", courseTitle: "Mode progress", category: "Science", description: "", lesson: lessons.a, outline: ["a", "b"].map((id, i) => ({ id, number: `0${i + 1}`, title: `Lesson ${id}`, href: `/${locale}/account/learn/course?lessonId=${id}`, modes: ["text", "video"] })), poster: "/portal/course-study.jpg", entitled: true, initialCompleted: false, nextHref: null, studyEndpoint: "/api/study/events", preferredMode: "video", initialContentId: "a-video-1" });
      const select = page.getByRole("combobox", { name: getMessages(locale).previewVideoDesign.learningMode });
      const video = page.locator("video.la-lesson-video");
      await page.waitForFunction(() => document.querySelector<HTMLVideoElement>("video.la-lesson-video")!.readyState >= 2);
      await select.selectOption("text"); await page.getByRole("alert").filter({ hasText: getMessages(locale).courseLearningMode.saveError }).waitFor();
      assert.equal(await select.inputValue(), "video", "failed saves retain the current Lesson/mode for retry");
      fail = false; await select.selectOption("text");
      await page.locator('[data-lesson-id="b"] [data-text-reader]').waitFor();
      await page.waitForFunction(() => document.querySelector('[data-lesson-id="b"] [aria-current="step"]')?.textContent?.includes("text 2"));
      assert.equal(await page.evaluate(() => new URL((window as any).destination, location.href).searchParams.get("contentId")), "b-text-2");
      // The active point updates before the browser applies the reader's scheduled scroll.
      await page.waitForFunction(() => (document.querySelector("[data-text-reader]")?.scrollTop || 0) > 0);
      assert.ok(await page.locator("[data-text-reader]").evaluate(element => element.scrollTop > 0));
      assert.deepEqual(modeRequests[1], { mode: "text", lessonId: "a" });
      await page.screenshot({ path: `test-results/course-mode-position/${locale}-text-last-position.png`, fullPage: true });
      await select.selectOption("video");
      await page.locator('[data-lesson-id="a"] video').waitFor();
      await page.waitForFunction(() => { const media = document.querySelector<HTMLVideoElement>("video.la-lesson-video"); return media && media.readyState >= 2 && Math.abs(media.currentTime - .5) < .03; });
      assert.equal(await video.evaluate(element => (element as HTMLVideoElement).paused), true, "switching locates the chapter without autoplay");
      assert.equal(modeRequests.at(-1)?.lessonId, "b");
      positions.text = { lessonId: "a", contentId: "a-text-4" };
      await select.selectOption("text");
      await page.waitForFunction(() => document.querySelector('[data-lesson-id="a"] [aria-current="step"]')?.textContent?.includes("text 4"));
      const reviewed = page.waitForRequest(request => request.url().includes("/api/study/") && request.postDataJSON()?.contentId === "a-text-3");
      await page.getByRole("button", { name: /^1\.3 text 3/ }).click();
      await reviewed;
      await page.waitForFunction(() => document.querySelector('[aria-current="step"]')?.textContent?.includes("text 3"));
      await select.selectOption("video"); await video.waitFor();
      await select.selectOption("text");
      await page.waitForFunction(() => document.querySelector('[aria-current="step"]')?.textContent?.includes("text 3"));
      await page.screenshot({ path: `test-results/course-mode-position/${locale}-last-reviewed-1-3.png`, fullPage: true });
      await select.selectOption("video"); await video.waitFor();
      const videoReviewed = page.waitForRequest(request => request.url().includes("/api/study/") && request.postDataJSON()?.contentId === "a-video-1");
      await page.getByRole("button", { name: /^1\.1 video 1/ }).click();
      await videoReviewed; await video.evaluate(element => (element as HTMLVideoElement).pause());
      await select.selectOption("text");
      await page.waitForFunction(() => document.querySelector('[aria-current="step"]')?.textContent?.includes("text 3"));
      await select.selectOption("video");
      await page.waitForFunction(() => { const media = document.querySelector<HTMLVideoElement>("video.la-lesson-video"); return media && media.readyState >= 2 && media.paused && media.currentTime < .03; });
      assert.equal(await page.locator('[aria-current="step"]').textContent(), "1.1 video 1", "video review also replaces the previous later cursor");
      positions.text = { lessonId: "b", contentId: "b-text-3" };
      await page.setViewportSize({ width: 390, height: 844 });
      await select.selectOption("text");
      await page.waitForFunction(() => document.querySelector('[data-lesson-id="b"] [aria-current="step"]')?.textContent?.includes("text 3"));
      await page.waitForFunction(() => {
        const reader = document.querySelector('[data-text-reader]'), target = document.querySelector('[data-text-point-id="b-text-3"]');
        if (!reader || !target) return false;
        const offset = target.getBoundingClientRect().top - reader.getBoundingClientRect().top;
        return offset >= 0 && offset < 40;
      });
      await page.screenshot({ path: `test-results/course-mode-position/${locale}-last-position-mobile.png`, fullPage: true });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

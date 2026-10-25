import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

test("video sub-chapters on the same file seek in place and keep playing", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PreviewLessonView} from './components/portal/PreviewLessonView';const root=createRoot(document.getElementById('root'));window.mount=p=>flushSync(()=>root.render(<PreviewLessonView key={p.key} {...p}/>));`,
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/portal/")) {
        return route.fulfill({ body: await readFile(`public${url.pathname}`), contentType: url.pathname.endsWith(".svg") ? "image/svg+xml" : "image/png" });
      }
      if (url.pathname.startsWith("/api/")) return route.fulfill({ json: { record: {} } });
      if (url.hostname !== "chapter.test") return route.fulfill({ status: 204 });
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><div id='root'></div>" });
    });
    await page.goto("http://chapter.test");
    await page.addScriptTag({ content: "window.__name=value=>value" });
    await page.addStyleTag({ content: await readFile("components/portal/lesson-authoring.css", "utf8") });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith("js"))!.text });
    const lesson = {
      id: "lesson",
      title: "Modeling",
      body: "",
      durationMinutes: 24,
      contents: [
        { id: "v1", title: "State Spaces", type: "video", mode: "lecture", url: "/api/course-media/modeling-life/video?sig=a", startSeconds: 10, nodes: [] },
        { id: "v2", title: "Defining Vectors", type: "video", mode: "lecture", url: "/api/course-media/modeling-life/video?sig=b", startSeconds: 412, nodes: [] },
      ],
    };
    await page.evaluate(props => (window as unknown as { mount: (p: unknown) => void }).mount(props), {
      key: "video",
      locale: "en-GB",
      courseId: "modeling-life",
      courseTitle: "Modeling life",
      category: "Science",
      description: "",
      poster: "/portal/course-study.jpg",
      lesson,
      outline: [{ id: "lesson", number: "01", title: lesson.title, href: "/lesson", modes: ["video"] }],
      nextHref: null,
      initialCompleted: false,
      entitled: true,
      preferredMode: "video",
    });
    const video = page.locator("video.la-lesson-video");
    await video.waitFor();
    await video.evaluate(el => {
      Object.defineProperty(el, "duration", { configurable: true, value: 1469 });
      let time = 0;
      Object.defineProperty(el, "currentTime", { configurable: true, get: () => time, set: value => { time = value; } });
      el.dispatchEvent(new Event("loadedmetadata"));
    });
    assert.equal(await video.evaluate(el => (el as HTMLVideoElement).currentTime), 10);
    await video.evaluate(el => {
      Object.defineProperty(el, "paused", { configurable: true, get: () => false });
      el.dispatchEvent(new Event("play"));
    });
    const identity = await video.evaluate(el => {
      (el as HTMLVideoElement & { marker?: string }).marker = "keep-me";
      return (el as HTMLVideoElement & { marker?: string }).marker;
    });
    await page.getByRole("button", { name: /^1\.2 Defining Vectors$/ }).click();
    assert.equal(await video.evaluate(el => (el as HTMLVideoElement & { marker?: string }).marker), identity);
    assert.equal(await video.evaluate(el => (el as HTMLVideoElement).currentTime), 412);
    assert.equal(await video.evaluate(el => (el as HTMLVideoElement).paused), false);
  } finally {
    await browser.close();
  }
});

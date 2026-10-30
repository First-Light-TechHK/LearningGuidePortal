import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getMessages } from "../../lib/i18n/messages";
import { lessonMessages } from "../../messages/lesson-authoring";

test("native/fallback fullscreen retains the lesson while real image/video/model and text Exhibits open and close", { timeout: 120000 }, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {LessonContentPlayer} from './components/portal/LessonContentPlayer';const root=createRoot(document.getElementById('root'));window.mount=p=>root.render(<LessonContentPlayer {...p}/>);` },
    bundle: true, write: false, outfile: "fullscreen-exhibit.js", platform: "browser", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "next", setup(builder) {
      builder.onResolve({ filter: /^next\/(image|dynamic)$/ }, args => ({ path: args.path, namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ resolveDir: process.cwd(), loader: "tsx", contents: args.path === "next/dynamic"
        ? "import React from 'react';export default function dynamic(factory){const Component=React.lazy(()=>factory().then(value=>({default:value})));return props=><React.Suspense fallback={null}><Component {...props}/></React.Suspense>}"
        : "import React from 'react';export default function Image({fill,unoptimized,...p}){return <img {...p} style={{...(fill?{position:'absolute',inset:0,width:'100%',height:'100%'}:{}),...p.style}}/>}" }));
      builder.onResolve({ filter: /CoursePdfPreview$/ }, args => ({ path: args.path, namespace: "pdf" }));
      builder.onLoad({ filter: /.*/, namespace: "pdf" }, () => ({ contents: "export const CoursePdfPreview=()=>null" }));
    } }],
  });
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  await mkdir("test-results/fullscreen-exhibit", { recursive: true });
  try {
    for (const locale of ["en-GB", "zh-CN"] as const) for (const fallback of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === "/lesson.webm" || pathname === "/exhibit.webm") return route.fulfill({ body: await readFile("tests/fixtures/media/flower.webm"), contentType: "video/webm" });
        if (pathname === "/model.obj") return route.fulfill({ body: "v -1 -1 0\nv 1 -1 0\nv 0 1 0\nv 0 0 1\nf 1 2 3\nf 1 2 4\nf 2 3 4\nf 3 1 4\n", contentType: "text/plain" });
        if (pathname === "/missing") return route.fulfill({ status: 404, body: "missing" });
        if (pathname.startsWith("/portal/")) return route.fulfill({ body: await readFile(`public${pathname}`), contentType: pathname.endsWith(".svg") ? "image/svg+xml" : "image/jpeg" });
        return route.fulfill({ body: '<div id="root"></div>', contentType: "text/html" });
      });
      await page.goto("http://fullscreen-exhibit.test");
      await page.addScriptTag({ content: "window.__name=value=>value" });
      for (const file of ["app/styles.css", "app/portal-design.css", "components/portal/lesson-authoring.css"]) await page.addStyleTag({ content: await readFile(file, "utf8") });
      await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith("css"))!.text });
      await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith("js"))!.text });
      const nodes = [
        { id: "image", type: "image", title: "Fixture image", url: "/portal/exh.jpg", triggerTime: 10 },
        { id: "video", type: "video", title: "Fixture video", url: "/exhibit.webm", triggerTime: 20 },
        { id: "model", type: "model3d", title: "Fixture model", url: "/model.obj", triggerTime: 30 },
        { id: "text", type: "text", title: "Fixture text", html: "<p>Fullscreen text Exhibit.</p>", triggerTime: 40 },
        { id: "missing", type: "image", title: "Missing image", url: "/missing", triggerTime: 50 },
      ];
      await page.evaluate(props => (window as any).mount(props), { locale, contents: [{ id: "lesson", title: "Lesson", type: "video", mode: "lecture", url: "/lesson.webm", exhibitMode: "authored", nodes }] });
      const lesson = page.locator("video.la-lesson-video"), owner = lesson.locator("..");
      await page.waitForFunction(() => document.querySelector<HTMLVideoElement>("video.la-lesson-video")!.readyState >= 2);
      await owner.evaluate((element, fallback) => {
        element.setAttribute("data-fullscreen-owner", "lesson");
        if (fallback) Object.defineProperty(element, "requestFullscreen", { value: undefined, configurable: true });
      }, fallback);
      await lesson.evaluate(element => {
        const media = element as HTMLVideoElement; media.loop = true;
        let time = 0;
        Object.defineProperty(media, "currentTime", { get: () => time, set: value => { time = value; }, configurable: true });
        Object.defineProperty(media, "duration", { value: 120, configurable: true });
        media.dispatchEvent(new Event("loadedmetadata"));
      });
      const fullscreen = owner.locator(":scope > .la-video-controls").getByRole("button", { name: lessonMessages(locale).videoFullscreen, exact: true });
      await fullscreen.click();
      await page.waitForFunction(fallback => {
        const element = document.querySelector('[data-fullscreen-owner="lesson"]');
        return fallback ? element?.classList.contains("la-video-expanded") : document.fullscreenElement === element;
      }, fallback);
      const retained = () => owner.evaluate((element, fallback) => fallback ? element.classList.contains("la-video-expanded") : document.fullscreenElement === element, fallback);
      assert.equal(await retained(), true);
      await lesson.evaluate(element => (element as HTMLVideoElement).play());
      for (const node of nodes) {
        await lesson.evaluate((element, time) => { const media = element as HTMLVideoElement; media.currentTime = time; media.dispatchEvent(new Event("seeked")); media.dispatchEvent(new Event("timeupdate")); }, node.triggerTime);
        await owner.locator('[data-video-exhibit="fullscreen"]').getByRole("button", { name: getMessages(locale).videoExhibit.view, exact: true }).click();
        const dialog = page.getByRole("dialog"); await dialog.waitFor();
        assert.equal(await retained(), true, `opening ${node.type} retains the fullscreen owner`);
        assert.equal(await dialog.evaluate(element => Boolean(element.closest('[data-fullscreen-owner="lesson"]'))), true);
        assert.equal(await lesson.evaluate(element => (element as HTMLVideoElement).paused), true);
        if (node.id === "image") await dialog.locator('img[alt="Fixture image"]').evaluate(image => (image as HTMLImageElement).decode());
        if (node.id === "image" || node.id === "model") {
          const zoom = dialog.getByRole("button", { name: getMessages(locale).exhibitDialog.zoomIn, exact: true });
          await page.waitForFunction(() => Array.from(document.querySelectorAll('dialog [role="group"] button')).some(button => !button.hasAttribute("disabled")));
          await zoom.click(); assert.notEqual(await dialog.locator("output").textContent(), "100%");
        }
        if (node.id === "video") {
          const exhibitVideo = dialog.locator("video");
          await page.waitForFunction(() => document.querySelector<HTMLVideoElement>("dialog video")!.readyState >= 2);
          assert.ok((await exhibitVideo.boundingBox())!.height < 800, "lesson fullscreen sizing must not stretch the nested Exhibit video");
          await exhibitVideo.evaluate(element => (element as HTMLVideoElement).play());
          await page.waitForFunction(() => !document.querySelector<HTMLVideoElement>("dialog video")!.paused);
          assert.equal(await lesson.evaluate(element => (element as HTMLVideoElement).paused), true);
          assert.equal(await dialog.locator(".la-video-controls").getByRole("button", { name: lessonMessages(locale).videoFullscreen, exact: true }).count(), 0, "the already fullscreen Exhibit does not expose a competing fullscreen toggle");
        }
        if (node.id === "text") await dialog.getByText("Fullscreen text Exhibit.").waitFor();
        if (node.id === "missing") await dialog.getByRole("alert").waitFor();
        await page.keyboard.press("Tab");
        assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, "focus stays in the viewer");
        if (node.id === "model" && fallback) await page.setViewportSize({ width: 844, height: 390 });
        if (node.id === "image" || node.id === "model") await page.screenshot({ path: `test-results/fullscreen-exhibit/${locale}-${fallback ? "fallback" : "native"}-${node.id}.png`, fullPage: true });
        if (node.id === "image") await page.keyboard.press("Escape");
        else await dialog.getByRole("button", { name: node.id === "text" ? lessonMessages(locale).close : getMessages(locale).exhibitDialog.close, exact: true }).click();
        assert.equal(await dialog.count(), 0);
        assert.equal(await retained(), true, "closing the viewer keeps the lesson fullscreen");
        assert.equal(await lesson.evaluate((element, time) => { const media = element as HTMLVideoElement; return media.paused && media.currentTime === time; }, node.triggerTime), true);
        if (fallback) await page.setViewportSize({ width: 1440, height: 1024 });
      }
      await fullscreen.click();
      await page.waitForFunction(fallback => {
        const element = document.querySelector('[data-fullscreen-owner="lesson"]');
        return fallback ? !element?.classList.contains("la-video-expanded") : document.fullscreenElement === null;
      }, fallback);
      assert.equal(await retained(), false, "the learner can still explicitly exit fullscreen");
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

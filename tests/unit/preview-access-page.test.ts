import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getMessages } from "../../lib/i18n/messages";

test("video previews choose access from the title row, share the cutoff modal and omit the video unlock banner", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PreviewLessonView} from './components/portal/PreviewLessonView';import {LessonContentPlayer} from './components/portal/LessonContentPlayer';const root=createRoot(document.getElementById('root'));window.mount=p=>flushSync(()=>root.render(p.standalone?<LessonContentPlayer key={p.key} contents={p.lesson.contents} locale={p.locale} trialGate={p.trialGate}/>:<PreviewLessonView key={p.key} {...p}/>));` }, bundle: true, write: false, outfile: "access.js", platform: "browser", jsx: "automatic", loader: { ".css": "local-css" }, external: ["/portal/*"], define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "next", setup(b) {
    b.onResolve({ filter: /Course(Model|Pdf)Preview$/ }, args => ({ path: args.path, namespace: "mock" }));
    b.onResolve({ filter: /^next\// }, args => ({ path: args.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path.endsWith("Preview") ? "export const CourseModelPreview=()=>null;export const CoursePdfPreview=()=>null" : args.path === "next/navigation" ? "export const useRouter=()=>({refresh(){},push(){}})" : args.path === "next/dynamic" ? "export default ()=>()=>null" : "import React from 'react';export default function Component({prefetch,unoptimized,...p}){return p.src?<img {...p}/>:<a {...p}/>}" }));
  } }] });
  const output = "test-results/preview-access"; await mkdir(output, { recursive: true });
  const browser = await chromium.launch();
  try { for (const locale of ["en-GB", "zh-CN"] as const) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } }), messages = getMessages(locale), copy = messages.previewAccess;
    const errors: string[] = [], study: { event: string }[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("http://access.test/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.startsWith("/api/study/")) { study.push(route.request().postDataJSON()); return route.fulfill({ json: { record: {} } }); }
      if (pathname.startsWith("/portal/")) return route.fulfill({ body: await readFile(path.join("public", pathname)), contentType: pathname.endsWith("svg") ? "image/svg+xml" : "image/jpeg" });
      if (pathname.endsWith("mp4")) return route.fulfill({ status: 404 });
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><div id="root"></div>' });
    });
    await page.goto("http://access.test/");
    for (const file of ["app/styles.css", "app/portal-design.css", "components/portal/lesson-authoring.css"]) await page.addStyleTag({ content: await readFile(file, "utf8") });
    await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith("css"))!.text });
    for (const weight of [400, 500, 600, 700]) { const font = (await readFile(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`)).toString("base64"); await page.addStyleTag({ content: `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font});font-weight:${weight}}` }); }
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith("js"))!.text });
    const pricingHref = `/${locale}/subscription?courseId=course`;
    const props = { locale, courseId: "course", courseTitle: "The Art of Seeing", category: "Art", description: "Learn to observe a work of art with attention, curiosity and confidence.", lesson: { id: "lesson", title: "Looking closely", body: "", durationMinutes: 2, contents: [{ id: "video", title: "Observe composition", type: "video", mode: "lecture", url: "/fixture.mp4", nodes: [] }, { id: "text", title: "Read visual cues", type: "text", mode: "lecture", html: "<p>Reading content.</p>", nodes: [] }] }, outline: [{ id: "lesson", title: "Looking closely", number: "01", href: "/lesson", modes: ["video", "text"] }], poster: "/portal/course-study.jpg", initialCompleted: false, nextHref: null, entitled: false, trialGate: { pricingHref, videoLimitSeconds: 60, recommendations: [{ title: "Related course one", href: `/${locale}/portal/courses/related-one`, image: "/portal/course-study.jpg" }, { title: "Related course two", href: `/${locale}/portal/courses/related-two` }] } };
    const mount = (key: string, extra: Record<string, unknown> = {}) => page.evaluate(p => (window as any).mount(p), { ...props, key, ...extra });
    const choose = page.getByRole("button", { name: copy.choosePlan, exact: true }), dialog = page.getByRole("dialog");
    await mount("preview"); await choose.waitFor(); await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.getByRole("link", { name: messages.previewVideoDesign.unlock, exact: true }).count(), 0);
    assert.equal(await page.getByRole("heading", { name: messages.previewVideoDesign.valueTitle, exact: true }).count(), 0);
    const player = (await page.locator(".la-player").locator("..").boundingBox())!, cta = (await choose.boundingBox())!;
    assert.equal(cta.x + cta.width, player.x + player.width - 20);
    assert.equal(cta.height, 37); if (locale === "en-GB") assert.ok(Math.abs(cta.width - 172) < 2);
    assert.deepEqual(await choose.evaluate(e => { const s = getComputedStyle(e); return [s.borderRadius, s.backgroundColor, s.fontSize, s.fontWeight]; }), ["8px", "rgb(29, 107, 255)", "14px", "600"]);
    await page.screenshot({ path: `${output}/${locale}-entry.png`, fullPage: true });
    await page.locator("video").evaluate(video => {
      const media = video as HTMLVideoElement;
      Object.defineProperty(media, "paused", { configurable: true, value: false });
      media.pause = new Function("Object.defineProperty(this, 'paused', { configurable: true, value: true });") as () => void;
      Object.defineProperty(media, "currentTime", { configurable: true, writable: true, value: 10 });
      Object.defineProperty(media, "duration", { configurable: true, value: 120 });
    });
    assert.equal(await page.locator("video").evaluate(video => (video as HTMLVideoElement).currentTime), 10, "fixture starts at the current preview position");
    await page.locator("video").evaluate(video => video.setAttribute("data-preview-identity", "same-video"));
    await choose.click(); await dialog.waitFor();
    assert.equal(await dialog.count(), 1); assert.equal(await dialog.getByRole("heading", { name: copy.heroTitle, exact: true }).count(), 1);
    assert.equal(await page.locator("video").evaluate(video => (video as HTMLVideoElement).paused), true);
    assert.equal(await page.locator("video").getAttribute("data-preview-identity"), "same-video", "opening the dialog must keep the player mounted");
    assert.equal(await page.locator("video").evaluate(video => (video as HTMLVideoElement).currentTime), 10);
    assert.equal(await dialog.getByRole("link", { name: copy.cta, exact: true }).getAttribute("href"), pricingHref);
    assert.equal(await dialog.locator(".la-trial-course").count(), 2);
    assert.equal(await dialog.locator(".la-trial-course").first().getAttribute("href"), props.trialGate.recommendations[0].href);
    assert.equal(await dialog.evaluate(e => e.parentElement === document.body), true);
    assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
    await dialog.locator("img").evaluateAll(async images => Promise.all(images.map(img => (img as HTMLImageElement).decode())));
    await page.screenshot({ path: `${output}/${locale}-dialog.png`, fullPage: true });
    await page.keyboard.press("Shift+Tab"); assert.equal(await dialog.getByRole("link", { name: copy.cta, exact: true }).evaluate(e => e === document.activeElement), true);
    await page.keyboard.press("Escape"); assert.equal(await dialog.count(), 0);
    assert.equal(await choose.evaluate(e => e === document.activeElement), true);
    assert.equal(await page.locator("video").evaluate(video => (video as HTMLVideoElement).paused), true, "closing never restarts preview playback");
    await choose.click(); await dialog.getByRole("button", { name: copy.close, exact: true }).click(); assert.equal(await dialog.count(), 0);
    await page.evaluate(() => {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: document.querySelector("video") });
      document.exitFullscreen = new Function("Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null }); return Promise.resolve();") as () => Promise<void>;
    });
    await page.locator("video").evaluate(video => { const media = video as HTMLVideoElement; media.currentTime = 75; media.dispatchEvent(new Event("seeked")); });
    await dialog.waitFor(); assert.equal(await page.locator("video").evaluate(video => (video as HTMLVideoElement).currentTime), 60);
    assert.equal(await page.evaluate(() => document.fullscreenElement), null);
    assert.equal(await dialog.count(), 1, "manual entry and the cutoff share one dialog");
    await page.keyboard.press("Escape");
    await page.locator("video").evaluate(video => video.dispatchEvent(new Event("play")));
    await dialog.waitFor(); assert.equal(await dialog.count(), 1); await page.keyboard.press("Escape");
    assert.equal(study.some(event => event.event === "complete"), false);
    for (const [width, height] of [[390, 844], [320, 700], [844, 390]]) {
      await page.setViewportSize({ width, height });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.ok((await choose.boundingBox())!.x >= 0); assert.ok((await choose.boundingBox())!.x + (await choose.boundingBox())!.width <= width);
      await choose.click(); await dialog.waitFor();
      assert.equal(await dialog.evaluate(e => e.scrollWidth > e.clientWidth), false);
      await dialog.getByRole("link", { name: copy.cta, exact: true }).scrollIntoViewIfNeeded();
      assert.ok((await dialog.boundingBox())!.height <= height - 40);
      if (width === 390) await page.screenshot({ path: `${output}/${locale}-mobile.png`, fullPage: true });
      await page.keyboard.press("Escape");
    }
    await page.setViewportSize({ width: 1440, height: 1024 });
    await choose.click(); await dialog.waitFor();
    await mount("preview", { entitled: true }); assert.equal(await choose.count(), 0); assert.equal(await dialog.count(), 0);
    assert.notEqual(await page.evaluate(() => document.body.style.overflow), "hidden");
    await mount("text", { preferredMode: "text" }); assert.equal(await page.locator("header").getByRole("button", { name: copy.choosePlan, exact: true }).count(), 1);
    assert.equal(await page.getByRole("link", { name: messages.previewVideoDesign.unlock, exact: true }).count(), 0, "text now uses the title entry and inline preview prompt");
    await mount("empty", { trialGate: undefined }); await choose.click();
    await dialog.getByText(copy.empty, { exact: true }).waitFor(); assert.equal(await dialog.getByRole("link", { name: copy.cta, exact: true }).getAttribute("href"), pricingHref);
    await page.keyboard.press("Escape");
    await mount("standalone", { standalone: true });
    await page.locator("video").evaluate(video => { const media = video as HTMLVideoElement; Object.defineProperty(media, "currentTime", { configurable: true, writable: true, value: 61 }); media.dispatchEvent(new Event("timeupdate")); });
    await dialog.getByRole("heading", { name: copy.heroTitle, exact: true }).waitFor();
    assert.deepEqual(errors, []); await page.close();
  } } finally { await browser.close(); }
});

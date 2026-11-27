import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getMessages } from "../../lib/i18n/messages";

test("video previews choose access from the title row, share the cutoff modal and omit the video unlock banner", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PreviewLessonView} from './components/portal/PreviewLessonView';import {LessonContentPlayer} from './components/portal/LessonContentPlayer';const root=createRoot(document.getElementById('root'));window.mount=p=>flushSync(()=>root.render(p.standalone?<LessonContentPlayer key={p.key} contents={p.lesson.contents} locale={p.locale} trialGate={p.trialGate}/>:<PreviewLessonView key={p.key} {...p}/>));` }, bundle: true, write: false, outfile: "access.js", platform: "browser", jsx: "automatic", loader: { ".css": "local-css", ".woff2": "dataurl" }, external: ["/portal/*"], define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "next", setup(b) {
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
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><main class="portal-page portal-public-lesson-page"><header class="portal-header">Learning Guide</header><div id="root"></div></main>' });
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
    assert.equal(cta.height, 37); if (locale === "en-GB") assert.ok(cta.width >= 150 && cta.width <= 200, `unexpected choose-plan width ${cta.width}`);
    assert.deepEqual(await choose.evaluate(e => { const s = getComputedStyle(e); return [s.borderRadius, s.backgroundColor, s.fontSize, s.fontWeight]; }), ["8px", "rgb(29, 107, 255)", "14px", "600"]);
    await page.screenshot({ path: `${output}/${locale}-entry.png`, fullPage: true });
    for (const width of [1920, 1501, 1500, 1499, 1440, 1200, 1024, 1023, 900, 768, 701, 700, 390]) {
      await page.setViewportSize({width,height:1024});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), width > 700 && width < 1500, `${locale}/${width}: video retains the desktop stage width on narrow screens`);
      if (width > 700) {
        const columns = await page.locator('[data-reading-outline]').evaluate(left => {
          const main=left.parentElement!.querySelector("article")!,right=left.parentElement!.querySelector("[data-reading-tools]")!;
          return {left:left.getBoundingClientRect().width,right:right.getBoundingClientRect().width,main:main.getBoundingClientRect().width,mainRight:main.getBoundingClientRect().right,toolsX:right.getBoundingClientRect().left,beside:right.getBoundingClientRect().left>=main.getBoundingClientRect().right-1};
        });
        assert.equal(columns.left,304); assert.equal(columns.right,160);
        assert.ok(columns.beside, `${width}: video tools stay in the right column ${JSON.stringify(columns)}`);
        assert.ok(Math.abs(columns.main - (1440-476)) < 1, 'video stage stops shrinking below its desktop minimum');
      }
      const frame = await page.locator('[data-course-id="course"]').evaluate(root => {
        const layout=root.querySelector('[data-reading-outline]')!.parentElement!, crumb=root.querySelector('[data-lesson-breadcrumb]')!;
        return {outer:root.getBoundingClientRect().right,layout:layout.getBoundingClientRect().right,crumb:crumb.getBoundingClientRect().right,header:document.querySelector(".portal-header")!.getBoundingClientRect().right,shell:document.querySelector(".portal-public-lesson-page")!.getBoundingClientRect().right};
      });
      assert.ok(frame.outer >= frame.layout && frame.crumb >= frame.layout && frame.header >= frame.layout && frame.shell >= frame.layout, `${locale}/${width}: background and breadcrumb cover the three-column frame ${JSON.stringify(frame)}`);
      if (width === 1024 || width === 768) await page.screenshot({path:`${output}/${locale}-columns-${width}.png`,fullPage:true});
    }
    const longTitle = "State Spaces, Vector Spaces and Trajectories";
    await mount("long-title", { lesson: { ...props.lesson, title: longTitle } });
    for (const width of [1300, 1366, 1440, 1600, 1920]) {
      await page.setViewportSize({ width, height: 1024 });
      const heading = page.getByRole("heading", { name: longTitle, exact: true });
      const geometry = await heading.evaluate(element => {
        const box = element.getBoundingClientRect(), header = element.parentElement!;
        const button = header.querySelector("button")!.getBoundingClientRect();
        return { height: box.height, line: parseFloat(getComputedStyle(element).lineHeight), beside: button.x >= box.right && Math.abs(button.y + button.height / 2 - box.y - box.height / 2) <= 1, right: button.right, edge: header.getBoundingClientRect().right - 20 };
      });
      // BUG-0353: same size as the subscribed title (28px), so beside the button it may take a second line on a narrow desktop.
      assert.ok(geometry.height <= geometry.line * 2 + 1, `${locale}/${width}: preview Lesson title fits in two lines`);
      assert.equal(geometry.beside, true, "purchase entry stays beside the Lesson title");
      assert.equal(geometry.right, geometry.edge);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), width < 1500);
      await page.screenshot({ path: `${output}/${locale}-title-${width}.png`, fullPage: true });
    }
    // BUG-0353: the preview title must render like the entitled (subscribed) one.
    const titleStyle = (element: Element) => {
      const style = getComputedStyle(element);
      return { fontSize: style.fontSize, lineHeight: style.lineHeight, fontWeight: style.fontWeight, textAlign: style.textAlign, margin: style.margin };
    };
    for (const width of [390, 1300, 1440]) {
      await page.setViewportSize({ width, height: 1024 });
      await mount("title-parity-preview");
      const previewTitle = await page.getByRole("heading", { name: "Looking closely", exact: true }).evaluate(titleStyle);
      await mount("title-parity-entitled", { entitled: true });
      const entitledTitle = await page.getByRole("heading", { name: "Looking closely", exact: true }).evaluate(titleStyle);
      assert.deepEqual(previewTitle, entitledTitle, `${locale}/${width}: preview title renders like the subscribed title`);
      // One shared rule: the subscribed title keeps its own size (28/38, 24/32 on a phone), the preview does not shrink it.
      assert.deepEqual([entitledTitle.fontSize, entitledTitle.lineHeight], width < 701 ? ["24px", "32px"] : ["28px", "38px"], `${locale}/${width}: shared title size`);
    }
    await page.setViewportSize({ width: 1440, height: 1024 });
    await mount("preview");

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
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), width > 700 && width < 1500);
      await choose.scrollIntoViewIfNeeded();
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

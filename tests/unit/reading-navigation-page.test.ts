import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getMessages } from "../../lib/i18n/messages";
import type { LessonBookmark, LessonBookmarkInput, LessonBookmarkSnapshot } from "../../contracts/lesson-bookmark";

test("text reading navigation preserves anchors, saves before leaving and offers retry without affecting previews or video", async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PreviewLessonView} from './components/portal/PreviewLessonView';const root=createRoot(document.getElementById('root'));window.mount=props=>flushSync(()=>root.render(<PreviewLessonView key={props.fixtureKey} {...props}/>));` },
    bundle: true, write: false, outfile: "reading.js", platform: "browser", jsx: "automatic",
    loader: { ".css": "local-css", ".woff2": "dataurl" }, external: ["/portal/*"],
    plugins: [{ name: "next", setup(b) {
      b.onResolve({ filter: /Course(Model|Pdf)Preview$/ }, args => ({ path: args.path, namespace: "mock" }));
      b.onResolve({ filter: /^next\// }, args => ({ path: args.path, namespace: "mock" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents:
        args.path.endsWith("Preview") ? "export const CourseModelPreview=()=>null;export const CoursePdfPreview=()=>null"
          : args.path === "next/navigation" ? "export const useRouter=()=>({refresh(){},push(){}})"
          : args.path === "next/dynamic" ? "export default ()=>()=>null"
          : "import React from 'react';export default function Component({prefetch,unoptimized,...props}){return props.src?<img {...props}/>:<a {...props}/>}" }));
    } }],
  });
  const output = "test-results/reading-navigation";
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch();
  try { for (const locale of ["en-GB", "zh-CN"] as const) {
    const copy = getMessages(locale).readingNavigation;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const writes: LessonBookmarkInput[] = [];
    let saved: LessonBookmark | undefined, fail = false, release: (() => void) | undefined, hold: Promise<void> | undefined;
    const lessonUrl = `http://reading.test/${locale}/lesson`, coursePath = `/${locale}/portal/courses/course`;
    await page.context().route("http://reading.test/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/api/study/bookmarks") {
        const input = route.request().postDataJSON() as LessonBookmarkInput; writes.push(input);
        if (hold) await hold;
        if (fail) return route.fulfill({ status: 503, json: { ok: false } });
        saved = { ...input, contentId: input.contentId || "t1", mode: "text", paragraphId: input.paragraphId!, revision: input.expectedRevision + 1, updatedAt: "2026-11-19T00:00:00Z", lpNumber: input.contentId === "t2" ? "1.2" : "1.1" };
        return route.fulfill({ json: { ok: true, data: saved } });
      }
      if (pathname.startsWith("/api/")) return route.fulfill({ json: { ok: true } });
      if (pathname.startsWith("/portal/")) return route.fulfill({ body: await readFile(path.join("public", pathname)) });
      if (pathname.endsWith("/lesson")) return route.fulfill({ contentType: "text/html", body: `<header class="portal-header" style="height:68px"><a href="/${locale}/portal/courses">Courses</a></header><div id="root"></div>` });
      return route.fulfill({ contentType: "text/html", body: `<h1>Destination</h1><p data-saved>${saved?.paragraphId || "none"}</p>` });
    });
    const contents = ["First reading", "Second reading"].map((title, index) => ({ id: `t${index + 1}`, title, type: "text", mode: "lecture", html: Array.from({ length: 35 }, (_, paragraph) => `<p>Paragraph ${paragraph}. Reading a long Lesson should keep navigation available without losing the current place.</p>`).join(""), nodes: [] }));
    contents.push({ id: "video", title: "Video", type: "video", mode: "lecture", html: "", nodes: [] });
    const snapshot = (): LessonBookmarkSnapshot => ({ versions: { lesson: { text: "v1", video: "video-v1" } }, bookmarks: saved ? { lesson: { text: saved } } : {} });
    const mount = async (fixtureKey: string, extra: Record<string, unknown> = {}) => {
      await page.goto(lessonUrl);
      for (const file of ["app/styles.css", "app/portal-design.css", "components/portal/lesson-authoring.css"]) await page.addStyleTag({ content: await readFile(file, "utf8") });
      await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith("css"))!.text });
      await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith("js"))!.text });
      await page.evaluate(props => (window as unknown as { mount: (props: unknown) => void }).mount(props), {
        fixtureKey, locale, courseId: "course", courseTitle: "Course", category: "Science", description: "Description", lesson: { id: "lesson", title: "A long Lesson title for reading navigation and narrow screen verification", durationMinutes: 10, body: "", contents },
        outline: [{ id: "lesson", number: "01", title: "Lesson", href: lessonUrl, modes: ["text", "video"] }, ...Array.from({length:24}, (_, index) => ({id:`other-${index}`, number:String(index+2).padStart(2,"0"), title:`Another long Lesson ${index+2}`, href:`${lessonUrl}?lessonId=other-${index}`, modes:["text"]}))],
        poster: "", entitled: true, tutorOnline: false, initialCompleted: false, nextHref: null,
        preferredMode: "text", initialContentId: "t1", bookmarkRestore: "position", bookmarkSnapshot: snapshot(), bookmarkOwnerId: "owner", ...extra,
      });
      if (extra.preferredMode !== "video") {
        await page.locator('[data-bookmark-ready="true"]').waitFor();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
      }
    };
    const bar = page.locator("[data-reading-toolbar]");
    const paragraph = (id: string, index: number) => page.locator(`[data-text-point-id="${id}"] .la-prose p`).nth(index);
    const scroll = (id: string, index: number) => paragraph(id, index).evaluate(element => {
      const height = document.querySelector("[data-reading-toolbar]")!.getBoundingClientRect().height;
      window.scrollTo(0, element.getBoundingClientRect().top + scrollY - height - 12);
    });
    await mount("start");
    assert.equal(await bar.getAttribute("aria-hidden"), "true");
    const documentY = await paragraph("t1", 8).evaluate(element => element.getBoundingClientRect().top + scrollY);
    await scroll("t1", 8);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok(await page.locator("[data-lesson-breadcrumb]").evaluate(element => element.getBoundingClientRect().bottom <= 0), JSON.stringify(await page.evaluate(() => ({ scroll: scrollY, bar: document.querySelector("[data-reading-toolbar]")?.getBoundingClientRect().height, paragraph: document.querySelectorAll(".la-prose p")[8]?.getBoundingClientRect().top, breadcrumb: document.querySelector("[data-lesson-breadcrumb]")?.getBoundingClientRect().bottom }))));
    await page.waitForFunction(() => document.querySelector('[data-reading-toolbar][data-visible="true"]'));
    assert.equal(await paragraph("t1", 8).evaluate(element => element.getBoundingClientRect().top + scrollY), documentY, "showing the bar does not shift the document");
    assert.equal(await bar.evaluate(element => element.getBoundingClientRect().top), 0);
    assert.ok(await page.locator("[data-reading-outline]").evaluate(element => element.getBoundingClientRect().top >= document.querySelector("[data-reading-toolbar]")!.getBoundingClientRect().bottom), "sticky outline clears the bar");
    for (const width of [1440, 1300, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(await bar.getByRole("link").allTextContents(), [copy.backToCourse, copy.myLearning]);
      assert.equal(await bar.locator('details,summary,[title]').count(), 0, "reading bar contains no title or overflow menu");
      if (width === 1440 || width === 390) await page.screenshot({ path: `${output}/${locale}-${width}.png` });
    }
    assert.equal(await bar.getByRole("button", {name:copy.outline,exact:true}).count(), 0, "compact navigation has no Outline entry");
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[data-reading-outline] [data-reading-point]').nth(1).click();
    await page.waitForFunction(() => Math.abs(document.querySelector('[data-text-point-id="t2"]')!.getBoundingClientRect().top - document.querySelector('[data-reading-toolbar]')!.getBoundingClientRect().bottom - 12) < 2);
    const sidebar = page.locator('[data-reading-outline]');
    assert.ok(await sidebar.evaluate(element => element.getBoundingClientRect().bottom <= innerHeight), "long lesson list stays inside the viewport");
    const outline = sidebar.locator('nav');
    assert.ok(await outline.locator('[data-reading-point]').last().evaluate(element => element.closest('nav')!.firstElementChild!.getBoundingClientRect().bottom >= element.getBoundingClientRect().bottom + 10), "long outlines preserve each Lesson card's content height");
    assert.ok(await outline.evaluate(element => element.scrollHeight > element.clientHeight), "long lesson lists scroll internally");
    const pageScroll = await page.evaluate(() => scrollY);
    await outline.evaluate(element => { element.scrollTop = element.scrollHeight; });
    assert.equal(await page.evaluate(() => scrollY), pageScroll, "scrolling the lesson list does not move the reading page");
    await outline.evaluate(element => { element.scrollTop = 0; });
    // A tall exhibit/tool list must also remain available beside the reading surface.
    await page.locator('[data-reading-tools]').evaluate(element => { const fixture = document.createElement('div'); fixture.dataset.tallTools = 'true'; fixture.style.height = '1200px'; fixture.style.flexShrink = '0'; element.appendChild(fixture); });
    await scroll('t2', 15);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const tools = page.locator('[data-reading-tools]');
    assert.ok(await tools.evaluate(element => element.getBoundingClientRect().top >= document.querySelector('[data-reading-toolbar]')!.getBoundingClientRect().bottom && element.getBoundingClientRect().bottom <= innerHeight), "tall Deep Learning remains visible below navigation");
    assert.ok(await tools.evaluate(element => element.scrollHeight > element.clientHeight));
    await tools.locator('[data-tall-tools]').evaluate(element => element.remove());
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => document.querySelector('[data-reading-toolbar][data-visible="false"]'));
    await scroll("t2", 9);
    hold = new Promise(resolve => { release = resolve; });
    const request = page.waitForRequest(request => request.url().endsWith("/api/study/bookmarks"));
    await bar.getByRole("link", { name: copy.backToCourse, exact: true }).click();
    await request;
    assert.equal(page.url(), lessonUrl, "navigation waits for the checkpoint");
    assert.equal(await bar.getAttribute("aria-busy"), "true");
    release!(); hold = undefined;
    await page.waitForURL(`http://reading.test${coursePath}`);
    assert.equal(await page.locator("[data-saved]").textContent(), "t2:paragraph:9");
    const count = writes.length;
    await mount("restore");
    const restored = await paragraph("t2", 9).boundingBox();
    assert.ok(restored && Math.abs(restored.y - (await bar.boundingBox())!.height - 12) < 2, "restored paragraph clears navigation");
    assert.equal(writes.length, count, "restoring a position does not write it again");
    await paragraph("t2", 9).evaluate(anchor => {
      const top = anchor.getBoundingClientRect().top;
      const spacer = document.createElement("div"); spacer.dataset.layoutShift = "true"; spacer.style.height = "300px";
      document.querySelector('[data-text-point-id="t1"]')!.prepend(spacer);
      window.scrollBy(0, anchor.getBoundingClientRect().top - top);
      window.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(900);
    assert.equal(writes.length, count, "layout anchoring while restoring does not replace the saved paragraph with the LP heading");
    await paragraph("t2", 9).evaluate(anchor => {
      const top = anchor.getBoundingClientRect().top;
      document.querySelector('[data-layout-shift]')!.remove();
      window.scrollBy(0, anchor.getBoundingClientRect().top - top);
    });
    const modifiedClickIntercepted = await bar.getByRole("link", { name: copy.backToCourse, exact: true }).evaluate(anchor => {
      let intercepted = true;
      anchor.addEventListener("click", event => { intercepted = event.defaultPrevented; event.preventDefault(); }, { once: true });
      anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
      return intercepted;
    });
    assert.equal(modifiedClickIntercepted, false, "modified clicks are left to the browser");
    await scroll("t1", 15); fail = true;
    await bar.getByRole("link", { name: copy.backToCourse, exact: true }).click();
    await bar.getByRole("alert").waitFor();
    assert.equal(page.url(), lessonUrl);
    fail = false;
    await bar.getByRole("button", { name: copy.retry, exact: true }).click();
    await page.waitForURL(`http://reading.test${coursePath}`);
    await mount("header-navigation");
    await scroll("t2", 17);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator(".portal-header a").click();
    await page.waitForURL(`http://reading.test/${locale}/portal/courses`);
    assert.equal(await page.locator("[data-saved]").textContent(), "t2:paragraph:17", "original header navigation also saves the latest reading point");
    await mount("overview-navigation");
    await scroll("t1", 12);
    await bar.getByRole("link", { name: copy.myLearning, exact: true }).first().click();
    await page.waitForURL(`http://reading.test/${locale}/account/my-learning`);
    assert.equal(await page.locator("[data-saved]").textContent(), "t1:paragraph:12");
    await mount("leave-anyway");
    await scroll("t2", 12); fail = true;
    await bar.getByRole("link", { name: copy.backToCourse, exact: true }).click();
    await bar.getByRole("alert").waitFor();
    await bar.getByRole("button", { name: copy.leave, exact: true }).click();
    await page.waitForURL(`http://reading.test${coursePath}`);
    fail = false;
    await mount("preview", { entitled: false, bookmarkSnapshot: undefined, bookmarkOwnerId: undefined });
    const previewCount = writes.length;
    await scroll("t1", 8);
    await bar.getByRole("link", { name: copy.backToCourse, exact: true }).click();
    await page.waitForURL(`http://reading.test${coursePath}`);
    assert.equal(writes.length, previewCount, "preview navigation does not create formal history");
    await mount("video", { preferredMode: "video", initialContentId: "video" });
    assert.equal(await bar.count(), 0, "video keeps the existing navigation");
    assert.deepEqual(errors, []);
    await page.close();
  } } finally { await browser.close(); }
});

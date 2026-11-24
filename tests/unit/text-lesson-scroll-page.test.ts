import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";

// BUG-0303: "I can't scroll down till the end of text unless I hold the page and move down".
// The early-November text lesson was an inner scroll box (overscroll-behavior: contain, taller than a
// laptop screen), so the wheel was swallowed and only dragging the page scroll bar reached the end.
test("a long text lesson can be read to its end with the wheel, the keyboard and a touch swipe", async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PreviewLessonView} from './components/portal/PreviewLessonView';const root=createRoot(document.getElementById('root'));window.mount=props=>flushSync(()=>root.render(<PreviewLessonView key={props.fixtureKey} {...props}/>));` },
    bundle: true, write: false, outfile: "scroll.js", platform: "browser", jsx: "automatic",
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
  const output = "test-results/text-lesson-scroll";
  await mkdir(output, { recursive: true });
  const css = ["app/styles.css", "app/portal-design.css", "components/portal/lesson-authoring.css"];
  const contents = ["First reading", "Second reading"].map((title, index) => ({ id: `t${index + 1}`, title, type: "text", mode: "lecture", html: Array.from({ length: 60 }, (_, paragraph) => `<p>Paragraph ${paragraph}${paragraph === 59 && index === 1 ? " LAST LINE" : ""}. A long Lesson text must always be readable down to its final line, with the wheel, with the keyboard and with touch.</p>`).join(""), nodes: [] }));
  const outline = [{ id: "lesson", number: "01", title: "Lesson", href: "http://scroll.test/en-GB/lesson", modes: ["text", "video"] }, ...Array.from({ length: 24 }, (_, index) => ({ id: `other-${index}`, number: String(index + 2).padStart(2, "0"), title: `Another long Lesson ${index + 2}`, href: `http://scroll.test/en-GB/lesson?lessonId=other-${index}`, modes: ["text"] }))];
  const browser = await chromium.launch();
  const open = async (viewport: { width: number; height: number }, touch: boolean) => {
    const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await context.route("http://scroll.test/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/api/study/bookmarks") return route.fulfill({ json: { ok: true, data: { versions: { lesson: { text: "v1", video: "video-v1" } }, bookmarks: {} } } });
      if (pathname.startsWith("/api/")) return route.fulfill({ json: { ok: true } });
      if (pathname.startsWith("/portal/")) return route.fulfill({ body: await readFile(path.join("public", pathname)) });
      return route.fulfill({ contentType: "text/html", body: `<meta name="viewport" content="width=device-width,initial-scale=1"><header class="portal-header" style="height:68px"><a href="/en-GB/portal/courses">Courses</a></header><div id="root"></div>` });
    });
    await page.goto("http://scroll.test/en-GB/lesson");
    for (const file of css) await page.addStyleTag({ content: await readFile(file, "utf8") });
    await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith("css"))!.text });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith("js"))!.text });
    await page.evaluate(props => (window as unknown as { mount: (props: unknown) => void }).mount(props), {
      fixtureKey: "scroll", locale: "en-GB", courseId: "course", courseTitle: "Course", category: "Science", description: "Description",
      lesson: { id: "lesson", title: "A long Lesson", durationMinutes: 10, body: "", contents }, outline,
      poster: "", entitled: true, tutorOnline: false, initialCompleted: false, nextHref: null,
      preferredMode: "text", initialContentId: "t1", bookmarkRestore: "position", bookmarkSnapshot: { versions: { lesson: { text: "v1", video: "video-v1" } }, bookmarks: {} }, bookmarkOwnerId: "owner",
    });
    await page.locator('[data-bookmark-ready="true"]').waitFor();
    await page.waitForTimeout(500);
    return { page, context, errors };
  };
  const state = (page: Page) => page.evaluate(() => {
    const paragraphs = [...document.querySelectorAll("[data-text-reader] .la-prose p")];
    const last = paragraphs.at(-1)!, rect = last.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + 20, rect.top + rect.height / 2);
    const trigger = document.querySelector("[data-text-completion-trigger]")!.getBoundingClientRect();
    return { content: document.querySelector("[data-text-reader]")!.scrollHeight, y: Math.round(scrollY), max: Math.round(document.documentElement.scrollHeight - innerHeight), lastText: last.textContent!.includes("LAST LINE"), lastVisible: rect.top >= 0 && rect.bottom <= innerHeight, lastUncovered: !!top && last.contains(top), triggerVisible: trigger.bottom <= innerHeight && trigger.top >= 0, overflowX: document.documentElement.scrollWidth > innerWidth };
  });
  const until = async (page: Page, step: () => Promise<void>) => {
    let same = 0, previous = -1;
    for (let index = 0; index < 900 && same < 8; index++) {
      await step(); await page.waitForTimeout(10);
      // Progress is the page position plus how far the lesson list has scrolled (it may take the first wheel ticks).
      const y = await page.evaluate(() => scrollY + [...document.querySelectorAll('[class*="outline"]')].reduce((sum, element) => sum + element.scrollTop, 0));
      if (y === previous) same++; else { same = 0; previous = y; }
    }
  };
  const check = async (page: Page, label: string) => {
    const end = await state(page);
    assert.ok(end.content > 3000, `${label}: the fixture lesson is long`);
    assert.ok(end.max - end.y <= 1, `${label}: reached the bottom of the page (${end.y}/${end.max})`);
    assert.ok(end.lastText && end.lastVisible && end.lastUncovered, `${label}: last line is inside the viewport and not covered ${JSON.stringify(end)}`);
    assert.ok(end.triggerVisible, `${label}: the end of the text is visible ${JSON.stringify(end)}`);
    assert.equal(end.overflowX, false);
    await page.waitForTimeout(1500);
    assert.equal((await state(page)).y, end.y, `${label}: the position does not jump back`);
  };
  try {
    for (const viewport of [{ width: 1366, height: 657 }, { width: 1920, height: 1080 }]) {
      const size = `${viewport.width}x${viewport.height}`;
      // The pointer is over the text, then over the lesson list: neither may swallow the wheel
      // (overscroll-behavior: contain on the list did, even when the list had nothing to scroll).
      for (const area of ["text", "sidebar"]) {
        const { page, context, errors } = await open(viewport, false);
        const point = await page.evaluate(area => {
          const box = (area === "text" ? document.querySelector("[data-text-reader]")! : document.querySelector('[class*="sidebar"]')!).getBoundingClientRect();
          return { x: box.left + box.width / 2, y: Math.min(innerHeight - 40, Math.max(box.top, 80) + 40) };
        }, area);
        await page.mouse.move(point.x, point.y);
        await until(page, () => page.mouse.wheel(0, 100));
        await check(page, `${size} wheel over ${area}`);
        if (area === "text") await page.screenshot({ path: `${output}/${size}-wheel.png` });
        assert.deepEqual(errors, []); await context.close();
      }
      for (const key of ["Space", "PageDown", "End"]) {
        const { page, context } = await open(viewport, false);
        await until(page, () => page.keyboard.press(key));
        await check(page, `${size} ${key}`); await context.close();
      }
    }
    const { page, context } = await open({ width: 390, height: 844 }, true);
    const cdp = await context.newCDPSession(page);
    // A finger drag: touch start, a run of moves up the screen, touch end.
    await until(page, async () => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: 700 }] });
      for (let step = 1; step <= 10; step++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 195, y: 700 - step * 40 }] }); await page.waitForTimeout(14); }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    });
    await check(page, "390x844 touch swipe");
    await page.screenshot({ path: `${output}/390x844-swipe.png` });
    await context.close();
  } finally { await browser.close(); }
});

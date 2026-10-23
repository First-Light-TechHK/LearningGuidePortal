import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getMessages } from "../../lib/i18n/messages";
import { buildTextLessonPreview } from "../../services/textLessonPreview";
import type { LessonContent } from "../../contracts/lesson-content";

test("text previews stop inline, blur withheld material and open access plans only on explicit clicks", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PreviewLessonView} from './components/portal/PreviewLessonView';const root=createRoot(document.getElementById('root'));window.mount=p=>flushSync(()=>root.render(<PreviewLessonView key={p.key} {...p}/>));` }, bundle: true, write: false, outfile: "text.js", platform: "browser", jsx: "automatic", loader: { ".css": "local-css" }, external: ["/portal/*"], define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "next", setup(b) {
    b.onResolve({ filter: /Course(Model|Pdf)Preview$/ }, args => ({ path: args.path, namespace: "mock" }));
    b.onResolve({ filter: /^next\// }, args => ({ path: args.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path.endsWith("Preview") ? "export const CourseModelPreview=()=>null;export const CoursePdfPreview=()=>null" : args.path === "next/navigation" ? "export const useRouter=()=>({refresh(){},push(){}})" : args.path === "next/dynamic" ? "export default ()=>()=>null" : "import React from 'react';export default function Component({prefetch,unoptimized,...p}){return p.src?<img {...p}/>:<a {...p}/>}" }));
  } }] });
  const output = "test-results/text-preview"; await mkdir(output, { recursive: true });
  const browser = await chromium.launch();
  try { for (const locale of ["en-GB", "zh-CN"] as const) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } }), copy = getMessages(locale).previewAccess;
    const errors: string[] = [], study: { contentId: string; event: string }[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("http://text.test/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.startsWith("/api/study/")) { study.push(route.request().postDataJSON()); return route.fulfill({ json: { record: {} } }); }
      if (pathname.startsWith("/portal/")) return route.fulfill({ body: await readFile(path.join("public", pathname)), contentType: pathname.endsWith("svg") ? "image/svg+xml" : "image/jpeg" });
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><div id="root"></div>' });
    });
    await page.goto("http://text.test/");
    for (const file of ["app/styles.css", "app/portal-design.css", "components/portal/lesson-authoring.css"]) await page.addStyleTag({ content: await readFile(file, "utf8") });
    await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith("css"))!.text });
    for (const weight of [400, 500, 600, 700]) { const font = (await readFile(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`)).toString("base64"); await page.addStyleTag({ content: `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font});font-weight:${weight}}` }); }
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith("js"))!.text });
    const reading = "Looking closely is not simply a matter of seeing more detail. It is a way of slowing down, noticing relationships, and allowing meaning to emerge over time. When we encounter an artwork, our first interpretation often arrives quickly. Careful observation asks us to pause before deciding what the work means.";
    const contents: LessonContent[] = ["Observe composition", "Read visual cues", "Form your own interpretation", "Continue in this Lesson"].map((title, index) => ({ id: `text-${index + 1}`, title, type: "text", mode: "lecture", html: index > 1 ? `<p>WITHHELD-SECRET-${index}</p>` : `<h2>Why close observation matters</h2>${Array.from({ length: 5 }, () => `<p>${reading}</p>`).join("")}`, nodes: [] }));
    const props = { locale, courseId: "course", courseTitle: "The Art of Seeing", category: "Art", description: "Learn to observe a work of art with attention, curiosity and confidence.", lesson: { id: "lesson", title: "Looking closely", body: "LEGACY-SECRET", durationMinutes: 2, contents }, outline: [{ id: "lesson", title: "Looking closely", number: "01", href: "/lesson", modes: ["text", "video"] }], poster: "", initialCompleted: false, nextHref: null, entitled: false, preferredMode: "text", trialGate: { pricingHref: `/${locale}/subscription?courseId=course`, recommendations: [] } };
    const mount = (key: string, lesson = props.lesson, entitled = false, initialContentId?: string) => {
      const projection = buildTextLessonPreview(lesson, "course", entitled);
      return page.evaluate(p => (window as any).mount(p), { ...props, key, entitled, initialContentId, textPreview: projection.textPreview, lesson: { ...lesson, contents: projection.contents, body: projection.body } });
    };
    const titleCta = page.locator("header").getByRole("button", { name: copy.choosePlan, exact: true }), dialog = page.getByRole("dialog"), end = page.locator("[data-text-preview-end]");
    await mount("points"); await titleCta.waitFor(); await page.evaluate(() => document.fonts.ready);
    assert.equal(await end.count(), 1, "continuous preview renders its boundary after all readable points"); assert.equal(await dialog.count(), 0);
    await titleCta.click(); await dialog.getByRole("heading", { name: copy.heroTitle }).waitFor(); await page.keyboard.press("Escape");
    assert.equal(await titleCta.evaluate(e => e === document.activeElement), true);
    await page.getByRole("button", { name: "1.2 Read visual cues", exact: true }).click();
    const scroller = page.getByLabel(getMessages(locale).previewVideoDesign.textMode, { exact: true }).filter({ has: end });
    await end.waitFor(); await scroller.evaluate(e => { e.scrollTop = e.scrollHeight; });
    await end.getByRole("button", { name: copy.choosePlan }).waitFor({ state: "visible" });
    assert.equal(await dialog.count(), 0, "scrolling to the preview boundary must never open a modal");
    assert.deepEqual(await end.locator("img").evaluate(e => [e.getBoundingClientRect().width, e.getBoundingClientRect().height, (e as HTMLImageElement).naturalWidth]), [16, 16, 16]);
    assert.equal(await end.locator("div").first().evaluate(e => getComputedStyle(e).filter), "blur(3px)");
    const card = end.getByRole("region", { name: copy.previewEnds });
    assert.deepEqual(await card.evaluate(e => { const s = getComputedStyle(e); return [s.borderRadius, s.padding, s.backgroundColor]; }), ["16px", "24px 32px", "rgb(255, 255, 255)"]);
    await page.screenshot({ path: `${output}/${locale}-boundary.png`, fullPage: true });
    await end.getByRole("button", { name: copy.choosePlan }).click(); await dialog.waitFor();
    assert.equal(await dialog.getByRole("link", { name: copy.cta }).getAttribute("href"), props.trialGate.pricingHref);
    await scroller.evaluate(element => { element.scrollTop = 0; });
    await page.waitForFunction(() => document.querySelector('button[aria-current="step"]')?.textContent?.includes("Observe composition"));
    assert.equal(await dialog.isVisible(), true, "scroll tracking cannot dismiss an explicitly opened access dialog");
    await page.keyboard.press("Escape");
    assert.equal(await end.getByRole("button", { name: copy.choosePlan }).evaluate(e => e === document.activeElement), true);
    await page.getByRole("button", { name: "1.3 Form your own interpretation", exact: true }).click();
    await end.waitFor(); assert.equal(await page.getByText("WITHHELD-SECRET-2", { exact: true }).count(), 0);
    assert.equal(await dialog.count(), 0); assert.equal(await page.locator(".la-content-player").count(), 2, "readable points stay mounted when jumping to a locked anchor");
    assert.equal(study.some(event => event.contentId === "text-3"), false, "locked point cannot advance preview progress");
    await page.getByRole("button", { name: "1.4 Continue in this Lesson", exact: true }).click(); assert.equal(await dialog.count(), 0);
    await mount("deep-link", props.lesson, false, "text-4"); await end.waitFor(); assert.equal(await dialog.count(), 0);
    for (const [width, height] of [[390, 844], [320, 700], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await end.getByRole("button", { name: copy.choosePlan }).scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await scroller.evaluate(e => e.scrollWidth > e.clientWidth), false);
      if (width === 390) await page.screenshot({ path: `${output}/${locale}-mobile.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1024 });
    const one = { ...props.lesson, contents: [contents[0]] };
    await mount("one", one); await end.waitFor(); await scroller.evaluate(e => { e.scrollTop = e.scrollHeight; }); assert.equal(await dialog.count(), 0);
    await page.screenshot({ path: `${output}/${locale}-half.png`, fullPage: true });
    const legacy = { ...props.lesson, body: "Readable half.\n\nReadable half.\n\nLOCKED-CONTENT.\n\nLOCKED-CONTENT.", contents: [] };
    await mount("legacy", legacy); await end.waitFor(); assert.equal(await page.getByText("LOCKED-CONTENT.", { exact: true }).count(), 0);
    await mount("two", { ...props.lesson, contents: contents.slice(0, 2) }, false, "text-2"); await end.waitFor();
    await mount("mixed", { ...props.lesson, contents: [{ id: "video", title: "Video", type: "video", mode: "lecture", url: "https://media.test/video.mp4", nodes: [] }, ...contents] });
    await page.getByRole("button", { name: "1.3 Form your own interpretation", exact: true }).click(); await end.waitFor(); assert.equal(await dialog.count(), 0);
    await mount("empty", { ...props.lesson, contents: [], body: "" }); await end.waitFor();
    assert.equal(await page.locator(".la-content-player,.lesson-body").count(), 0, "empty lessons cannot fabricate sample reading before the cutoff");
    await mount("entitled", props.lesson, true, "text-4");
    assert.equal(await titleCta.count(), 0); assert.equal(await end.count(), 0); await page.getByText("WITHHELD-SECRET-3", { exact: true }).waitFor();
    await mount("expired", props.lesson, false, "text-4"); await end.waitFor(); assert.equal(await titleCta.count(), 1);
    await titleCta.click(); await dialog.waitFor(); await mount("expired", props.lesson, true, "text-4"); assert.equal(await dialog.count(), 0);
    assert.equal(study.some(event => event.event === "complete"), false); assert.deepEqual(errors, []); await page.close();
  } } finally { await browser.close(); }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getMessages } from "../../lib/i18n/messages";

test("lesson tools show access hints only for unentitled previews and retain enabled actions and text completion behavior", async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PreviewLessonView} from './components/portal/PreviewLessonView';const root=createRoot(document.getElementById('root'));window.mount=props=>flushSync(()=>root.render(<PreviewLessonView key={props.key} {...props}/>));` },
    bundle: true, write: false, outfile: "tools.js", platform: "browser", jsx: "automatic", loader: { ".css": "local-css" }, external: ["/portal/*"],
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "next", setup(builder) {
      builder.onResolve({ filter: /Course(Model|Pdf)Preview$/ }, args => ({ path: args.path, namespace: "mock" }));
      builder.onResolve({ filter: /^next\// }, args => ({ path: args.path, namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents:
        args.path.endsWith("Preview") ? "export const CourseModelPreview=()=>null;export const CoursePdfPreview=()=>null"
          : args.path === "next/navigation" ? "export const useRouter=()=>({refresh(){},push(url){window.destination=url}})"
          : args.path === "next/dynamic" ? "export default ()=>()=>null"
          : "import React from 'react';export default function Component({prefetch,unoptimized,...props}){return props.src?<img {...props}/>:<a {...props}/>}" }));
    } }],
  });
  await mkdir("test-results/lesson-tools", { recursive: true });
  const browser = await chromium.launch();
  try { for (const locale of ["en-GB", "zh-CN"] as const) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("http://tools.test/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.startsWith("/api/")) return route.fulfill({ json: { record: {} } });
      if (pathname.startsWith("/portal/")) return route.fulfill({ body: await readFile(path.join("public", pathname)), contentType: pathname.endsWith("svg") ? "image/svg+xml" : "image/jpeg" });
      if (pathname.endsWith("mp4")) return route.fulfill({ status: 404 });
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><div id="root"></div>' });
    });
    await page.goto("http://tools.test/");
    for (const file of ["app/styles.css", "app/portal-design.css", "components/portal/lesson-authoring.css"]) await page.addStyleTag({ content: await readFile(file, "utf8") });
    await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith("css"))!.text });
    for (const weight of [400, 500, 600, 700]) {
      const font = (await readFile(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`)).toString("base64");
      await page.addStyleTag({ content: `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font});font-weight:${weight}}` });
    }
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith("js"))!.text });
    const messages = getMessages(locale), copy = messages.previewVideoDesign;
    const mount = (key: string, entitled: boolean, type = "video", title = "Looking closely") => page.evaluate(props => (window as unknown as { mount: (p: unknown) => void }).mount(props), {
      key, locale, entitled, courseId: "course", courseTitle: "The Art of Seeing", category: "Art", description: "Learn to observe a work of art with attention, curiosity and confidence.",
      lesson: { id: "lesson", title, body: type === "legacy" ? "Legacy reading content." : "", durationMinutes: 2, contents: type === "legacy" ? [] : [{ id: "content", type, title: "Observe composition", mode: "lecture", nodes: [], ...(type === "text" ? { html: "<p>Reading content.</p>" } : { url: "/fixture.mp4" }) }] },
      outline: [{ id: "lesson", title, number: "01", href: "/lesson" }], poster: "/portal/course-study.jpg", initialCompleted: false, nextHref: "/next", studyEndpoint: "/api/study/events",
    });
    const tools = page.getByRole("complementary", { name: copy.deepLearning });
    for (const entitled of [true, false]) {
      await mount(`video-${entitled}`, entitled);
      await tools.waitFor();
      await page.evaluate(() => document.fonts.ready);
      const controls = tools.locator("button,a");
      assert.equal(await controls.count(), 3);
      assert.equal(await tools.getByRole("heading").locator("img").count(), 0);
      const card = (await page.locator(".la-player").locator("..").boundingBox())!;
      const column = (await tools.boundingBox())!;
      assert.equal(column.width, 160);
      assert.equal(column.x - (card.x + card.width), 24, "column is beside the player card");
      assert.equal(column.y - card.y, 10, "column follows the actual player position");
      await page.screenshot({ path: `test-results/lesson-tools/${locale}-${entitled ? "active" : "locked"}-layout.png`, fullPage: true });
      const tooltip = tools.getByRole("tooltip", { includeHidden: true });
      assert.equal(await tooltip.count(), entitled ? 0 : 1);
      assert.equal(await tools.getAttribute("aria-describedby"), entitled ? null : await tooltip.getAttribute("id"));
      assert.equal(await tools.getAttribute("tabindex"), entitled ? null : "0");
      for (const [index, control] of (await controls.all()).entries()) {
        const styles = await control.evaluate(element => {
          const css = getComputedStyle(element), icon = element.querySelector("img") as HTMLImageElement;
          return { radius: [css.borderTopLeftRadius, css.borderTopRightRadius, css.borderBottomRightRadius, css.borderBottomLeftRadius], width: element.getBoundingClientRect().width, border: css.borderTopColor, loaded: icon.complete && icon.naturalWidth > 0, iconWidth: icon.getBoundingClientRect().width, iconHeight: icon.getBoundingClientRect().height };
        });
        assert.deepEqual(styles.radius, ["12px", "12px", "12px", "12px"]);
        assert.equal(styles.width, 160); assert.equal(styles.border, "rgb(228, 231, 237)");
        assert.equal(styles.loaded, true); assert.equal(styles.iconWidth, 16); assert.equal(styles.iconHeight, 16);
        if (!entitled) assert.equal(await control.isDisabled(), true);
        const wrapper = control.locator("..");
        assert.equal(await wrapper.getByRole("tooltip", { includeHidden: true }).count(), 0);
        assert.equal(await wrapper.getAttribute("tabindex"), null);
        assert.equal(await control.getAttribute("aria-describedby"), null);
        assert.equal(await wrapper.getAttribute("aria-describedby"), null);
        if (entitled) {
          assert.equal(await tooltip.count(), 0);
          assert.equal(await control.getAttribute("aria-describedby"), null);
          assert.equal(await wrapper.getAttribute("aria-describedby"), null);
          await wrapper.hover();
          assert.equal(await tools.getByRole("tooltip", { includeHidden: true }).count(), 0);
          if (index === 1) await page.screenshot({ path: `test-results/lesson-tools/${locale}-active.png`, fullPage: true });
          await control.focus();
          assert.equal(await tools.getByRole("tooltip", { includeHidden: true }).count(), 0);
          await page.keyboard.press("Tab");
          await page.locator("h1").click();
          continue;
        }
        await page.mouse.move(0, 0);
        assert.equal(await tooltip.isVisible(), false);
        await wrapper.hover();
        assert.equal(await tooltip.isVisible(), true);
        assert.equal(await tooltip.textContent(), copy.includedWithFullAccess);
        if (index === 1) await page.screenshot({ path: `test-results/lesson-tools/${locale}-${entitled ? "active" : "locked"}.png`, fullPage: true });
        await page.mouse.move(0, 0);
        await tools.focus();
        assert.equal(await tooltip.isVisible(), true, "keyboard focus describes the whole disabled area once");
        await page.keyboard.press("Tab");
        await page.locator("h1").click();
      }
      await page.mouse.move(0, 0);await page.locator("h1").click();
      await tools.getByRole("heading").hover();
      if (!entitled) assert.equal(await tooltip.isVisible(), true, "the heading is part of the area trigger");
      const bounds=(await tools.boundingBox())!;
      await tools.hover({position:{x:bounds.width/2,y:29}});
      if (!entitled) assert.equal(await tooltip.isVisible(), true, "the gap between heading and buttons keeps the shared hint open");
      if (entitled) {
        assert.equal(await controls.nth(1).getAttribute("href"), `/${locale}/portal/courses/course/understanding?lessonId=lesson`);
        await controls.nth(2).click(); await page.getByRole("dialog").waitFor(); await page.keyboard.press("Escape");
      }
      for (const width of [1200, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1024 });
        await page.locator("h1").click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.ok((await tools.boundingBox())!.y >= (await page.locator("video").boundingBox())!.y + (await page.locator("video").boundingBox())!.height);
        const first = controls.first().locator(".."); await first.hover();
        if (entitled) assert.equal(await tools.getByRole("tooltip", { includeHidden: true }).count(), 0);
        else {
          const tip = (await tooltip.boundingBox())!;
          assert.ok(tip.x >= 0 && tip.x + tip.width <= width);
        }
        if (width === 390) await page.screenshot({ path: `test-results/lesson-tools/${locale}-${entitled ? "active" : "locked"}-mobile.png`, fullPage: true });
      }
      await page.setViewportSize({ width: 1440, height: 1024 });
    }
    await mount("long-title", true, "video", "A long lesson title that wraps onto multiple lines to check alignment with the actual player below the heading");
    assert.equal((await tools.boundingBox())!.y - (await page.locator(".la-player").locator("..").boundingBox())!.y, 10);
    await mount("access-change", false); assert.equal(await tools.getByRole("tooltip", { includeHidden: true }).count(), 1);
    await mount("access-change", true); assert.equal(await tools.getByRole("tooltip", { includeHidden: true }).count(), 0);
    assert.equal(await tools.getAttribute("aria-describedby"), null);assert.equal(await tools.getAttribute("tabindex"), null);
    await mount("access-change", false); assert.equal(await tools.getByRole("tooltip", { includeHidden: true }).count(), 1);
    for (const type of ["text", "pdf", "legacy"]) {
      await mount(type, true, type);
      assert.equal(await page.getByRole("button", { name: messages.learning.completeLesson, exact: true }).count(), 0);
      assert.equal(await page.locator(".preview-progress button").count(), 0);
      assert.equal(await page.getByRole("button", { name: messages.learning.nextLesson, exact: true }).isVisible(), true);
      if (type === "text") await page.screenshot({ path: `test-results/lesson-tools/${locale}-text.png`, fullPage: true });
    }
    assert.deepEqual(errors, []);
    await page.close();
  } } finally { await browser.close(); }
});

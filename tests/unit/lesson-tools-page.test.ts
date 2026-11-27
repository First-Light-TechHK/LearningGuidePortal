import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { browserAssertionEvidence } from "../fixtures/browser-assertion-evidence";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getMessages } from "../../lib/i18n/messages";

test("lesson tools show access hints only for unentitled previews and retain enabled actions and text completion behavior", async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PreviewLessonView} from './components/portal/PreviewLessonView';const root=createRoot(document.getElementById('root'));window.mount=props=>flushSync(()=>root.render(<PreviewLessonView key={props.key} {...props}/>));` },
    bundle: true, write: false, outfile: "tools.js", platform: "browser", jsx: "automatic", loader: { ".css": "local-css", ".woff2": "dataurl" }, external: ["/portal/*"],
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
    const mount = (key: string, entitled: boolean, type = "video", title = "Looking closely", readingHtml = "<p>Reading content.</p>", outlineCount = 1) => page.evaluate(props => (window as unknown as { mount: (p: unknown) => void }).mount(props), {
      key, locale, entitled, courseId: "course", courseTitle: "The Art of Seeing", category: "Art", description: "Learn to observe a work of art with attention, curiosity and confidence.",
      lesson: { id: "lesson", title, body: type === "legacy" ? "Legacy reading content." : "", durationMinutes: 2, contents: type === "legacy" ? [] : [{ id: "content", type, title: "Observe composition", mode: "lecture", nodes: [], ...(type === "text" ? { html: readingHtml } : { url: "/fixture.mp4" }) }] },
      outline: Array.from({ length: outlineCount }, (_, index) => ({ id: index ? `lesson-${index}` : "lesson", title, number: String(index + 1).padStart(2, "0"), href: `/lesson-${index}` })), poster: "/portal/course-study.jpg", initialCompleted: false, nextHref: "/next", studyEndpoint: "/api/study/events",
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
      const outlineHeading = page.locator('[data-reading-outline] h2');
      assert.ok(Math.abs((await tools.getByRole('heading').boundingBox())!.y - (await outlineHeading.boundingBox())!.y) <= 1, 'video sidebar headings align');
      await page.setViewportSize({ width: 1440, height: 700 });
      await page.evaluate(() => window.scrollTo(0, 200));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const stickyTop = (await tools.getByRole('heading').boundingBox())!.y;
      assert.ok(Math.abs(stickyTop - (await outlineHeading.boundingBox())!.y) <= 1, 'video sidebars stay aligned after scrolling');
      assert.ok(Math.abs(stickyTop - 12) <= 1);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.setViewportSize({ width: 1440, height: 1024 });
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
        // Desktop Lesson layouts keep their 1500px stage (see preview-access-page), so a
        // narrower desktop window scrolls sideways; phone widths still fit the viewport.
        const canvasScrolls = width > 700 && width < 1500;
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), canvasScrolls, `${locale}/${width}: desktop stage keeps its width`);
        const toolsBox = (await tools.boundingBox())!, videoBox = (await page.locator("video").boundingBox())!;
        if (width > 700) assert.ok(toolsBox.x >= videoBox.x + videoBox.width - 1, `${locale}/${width}: desktop tools stay in the right column`);
        else assert.ok(toolsBox.y >= videoBox.y + videoBox.height, `${locale}/${width}: phone widths stack the tools under the player`);
        const first = controls.first().locator(".."); await first.hover();
        if (entitled) assert.equal(await tools.getByRole("tooltip", { includeHidden: true }).count(), 0);
        else {
          const canvas = await page.evaluate(() => document.documentElement.scrollWidth);
          const tip = (await tooltip.boundingBox())!;
          assert.ok(tip.x >= 0 && tip.x + tip.width <= canvas, `${locale}/${width}: the hint stays on the stage`);
        }
        if (width === 390) await page.screenshot({ path: `test-results/lesson-tools/${locale}-${entitled ? "active" : "locked"}-mobile.png`, fullPage: true });
      }
      await page.setViewportSize({ width: 1440, height: 1024 });
    }
    await mount("long-title", true, "video", "A long lesson title that wraps onto multiple lines to check alignment with the actual player below the heading");
    assert.ok(Math.abs((await tools.getByRole("heading").boundingBox())!.y - (await page.locator("[data-reading-outline] h2").boundingBox())!.y) <= 1);
    await mount("access-change", false); assert.equal(await tools.getByRole("tooltip", { includeHidden: true }).count(), 1);
    await mount("access-change", true); assert.equal(await tools.getByRole("tooltip", { includeHidden: true }).count(), 0);
    assert.equal(await tools.getAttribute("aria-describedby"), null);assert.equal(await tools.getAttribute("tabindex"), null);
    await mount("access-change", false); assert.equal(await tools.getByRole("tooltip", { includeHidden: true }).count(), 1);
    for (const type of ["text", "pdf", "legacy"]) {
      await mount(type, true, type);
      assert.equal(await page.getByRole("button", { name: messages.learning.completeLesson, exact: true }).count(), 0);
      assert.equal(await page.locator(".preview-progress button").count(), 0);
      assert.equal(await page.getByRole("button", { name: messages.videoCompletion.markComplete, exact: true }).isVisible(), true);
      if (type === "text") await page.screenshot({ path: `test-results/lesson-tools/${locale}-text.png`, fullPage: true });
    }
    async function assertCompletionPosition(width: number) {
      await page.waitForFunction(() => {
        const button = document.querySelector('[data-text-completion] button')?.getBoundingClientRect();
        const tools = document.querySelector('[data-reading-tools]')?.getBoundingClientRect();
        // The desktop stage keeps three columns down to 701px, so the completion action
        // stays aligned with the right column there and hugs the viewport on phones.
        return button && tools && Math.abs(innerHeight - button.bottom - 30) < 1 && (innerWidth > 700 ? Math.abs(button.left - tools.left) < 1 : Math.abs(innerWidth - button.right - 24) < 1);
      });
      const button = page.locator('[data-text-completion] button');
      const box = (await button.boundingBox())!;
      const canvas = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(box.x >= 0 && box.x + box.width <= canvas, 'completion remains inside the stage');
      assert.equal(await button.evaluate(element => getComputedStyle(element).borderRadius), '8px');
    }
    const longReading = '<p>Read slowly and observe the relationships in this lesson.</p>'.repeat(80);
    for (const width of [1440, 1920, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      await mount(`aligned-${width}`, true, "text", "A long text lesson title that can wrap onto several lines", longReading);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForFunction(() => [...document.querySelectorAll('[data-reading-outline],[data-reading-tools]')].every(element => element.getAttribute('data-reading-sticky') === 'true'));
      const outline = page.locator('[data-reading-outline]');
      const left = (await outline.getByRole('heading').boundingBox())!;
      const right = (await tools.getByRole('heading').boundingBox())!;
      assert.ok(Math.abs(left.y - right.y) <= 1, 'both sidebar headings start together');
      assert.ok(Math.abs(left.y - (await page.locator('article > header').boundingBox())!.y) <= 1, 'sidebars start alongside the lesson header');
      await assertCompletionPosition(width);
      if (width === 1440) await page.screenshot({ path: `test-results/lesson-tools/${locale}-reading-aligned-top.png` });
      for (const scrollTop of [300, 700]) {
        await page.evaluate(top => window.scrollTo(0, top), scrollTop);
        const toolbar = page.locator('[data-reading-toolbar][data-visible="true"]');
        await toolbar.waitFor({ state: "visible" });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const leftTop = (await outline.getByRole('heading').boundingBox())!.y;
        const rightTop = (await tools.getByRole('heading').boundingBox())!.y;
        assert.ok(Math.abs(leftTop - rightTop) <= 1, 'both headings stay aligned after scrolling');
        const toolbarBottom = await toolbar.evaluate(element => element.getBoundingClientRect().bottom);
        assert.ok(Math.abs(leftTop - toolbarBottom - 12) <= 1, `sticky content starts 12px below the reading toolbar, received ${leftTop - toolbarBottom}px`);
        await assertCompletionPosition(width);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (width === 1440) await page.screenshot({ path: `test-results/lesson-tools/${locale}-reading-aligned-scroll.png` });
    }
    await page.setViewportSize({ width: 1440, height: 700 });
    await mount('long-outline', true, 'text', 'Looking closely', longReading, 40);
    const longOutline = page.locator('[data-reading-outline] nav');
    await page.waitForFunction(() => document.querySelector('[data-reading-outline]')?.getAttribute('data-reading-sticky') === 'true');
    const waitForToolbar = async (visible: boolean) => page.waitForFunction(expected => {
      const bar = document.querySelector<HTMLElement>('[data-reading-toolbar]');
      const root = document.querySelector<HTMLElement>('[data-reading-outline]');
      const inset = root ? parseFloat(getComputedStyle(root).getPropertyValue('--reading-top-inset')) : NaN;
      return bar?.getAttribute('data-visible') === String(expected) && inset === (expected ? Math.ceil(bar.getBoundingClientRect().height) : 0);
    }, visible);
    const atBottom = async () => page.waitForFunction(() => {
      const nav = document.querySelector<HTMLElement>('[data-reading-outline] nav');
      return nav && nav.scrollHeight > nav.clientHeight && nav.scrollTop > 0 && nav.scrollTop >= nav.scrollHeight - nav.clientHeight - 1;
    });
    const last = longOutline.getByRole('link').last();
    const assertLastVisible = async () => {
      const geometry = await last.evaluate(element => {
        const nav = element.closest('nav')!, list = nav.getBoundingClientRect(), link = element.getBoundingClientRect();
        const hit = document.elementFromPoint(link.left + link.width / 2, link.top + link.height / 2);
        return { navTop: list.top, navBottom: list.bottom, linkTop: link.top, linkBottom: link.bottom,
          href: element.getAttribute('href'), hit: !!hit && element.contains(hit), scrollTop: nav.scrollTop,
          scrollHeight: nav.scrollHeight, clientHeight: nav.clientHeight,
          inset: getComputedStyle(nav).getPropertyValue('--reading-top-inset'),
          toolbarVisible: document.querySelector('[data-reading-toolbar]')?.getAttribute('data-visible') };
      });
      const visible = geometry.linkTop >= geometry.navTop && geometry.linkBottom <= geometry.navBottom;
      const evidence = visible && geometry.hit ? '' : await browserAssertionEvidence(page, 'test-results/lesson-tools', locale+'-outline-failure', 'tests/unit/lesson-tools-page.test.ts', { locale, geometry });
      assert.ok(visible, `the whole final lesson is visible: ${JSON.stringify(geometry)}; ${evidence}`);
      assert.equal(geometry.hit, true, 'the final lesson is not covered');
      assert.equal(geometry.href, '/lesson-39?viewMode=text&modeSwitch=1');
    };
    // A real wheel gesture reaches the bottom with the toolbar hidden; then the
    // page scroll reveals the toolbar and shrinks the outline viewport.
    await page.evaluate(() => window.scrollTo(0, 0));
    await waitForToolbar(false);
    await longOutline.hover(); await page.mouse.wheel(0, 10000); await atBottom();
    await assertLastVisible();
    await page.mouse.move(900, 400); await page.mouse.wheel(0, 700); await waitForToolbar(true);
    await assertLastVisible();
    // A reader part-way through the outline must not be moved to the end.
    await page.evaluate(() => window.scrollTo(0, 0)); await waitForToolbar(false);
    await longOutline.hover(); await page.mouse.wheel(0, -1000);
    await page.waitForFunction(() => { const n=document.querySelector<HTMLElement>('[data-reading-outline] nav');return n && n.scrollTop < n.scrollHeight-n.clientHeight-100; });
    const middle = await longOutline.evaluate(n => n.scrollTop);
    assert.ok(middle > 0, 'the reader is genuinely part-way through the outline');
    await page.mouse.move(900, 400); await page.mouse.wheel(0, 700); await waitForToolbar(true);
    assert.equal(await longOutline.evaluate(n => n.scrollTop), middle, 'toolbar reflow preserves a middle position');
    for (const width of [1200, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await mount(`reading-narrow-${width}`, true, 'text', 'Looking closely', longReading);
      // A text Lesson keeps a 1300px stage, so narrower desktop windows scroll sideways.
      const canvasScrolls = width > 700 && width < 1300;
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), canvasScrolls, `${locale}/${width}: text stage keeps its width`);
      const toolsBox = (await tools.boundingBox())!, articleBox = (await page.locator('article').boundingBox())!;
      if (width > 700) assert.ok(toolsBox.x >= articleBox.x + articleBox.width - 1, 'desktop tools stay beside the reading article');
      else assert.ok(toolsBox.y >= articleBox.y + articleBox.height - 1, 'narrow screens keep tools after the reading article');
      await assertCompletionPosition(width);
    }
    // Verify a real click reaches the final lesson's destination.
    await page.setViewportSize({ width: 1440, height: 700 });
    await mount('long-outline-click', true, 'text', 'Looking closely', longReading, 40);
    await page.evaluate(() => window.scrollTo(0, 700)); await waitForToolbar(true);
    await longOutline.hover(); await page.mouse.wheel(0, 10000); await atBottom();
    await assertLastVisible(); await last.click();
    await page.waitForURL('http://tools.test/lesson-39?viewMode=text&modeSwitch=1');
    assert.deepEqual(errors, []);
    await page.close();
  } } finally { await browser.close(); }
});

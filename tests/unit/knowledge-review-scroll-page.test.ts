import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, expect } from "playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getMessages } from "../../lib/i18n/messages";

test("Knowledge Result Review supports wheel and draggable scrollbars for long result lists and answers", { timeout: 120_000 }, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {KnowledgeTestDialog} from './components/portal/KnowledgeTestDialog';
    const root=createRoot(document.getElementById('root'));window.mount=locale=>root.render(<KnowledgeTestDialog key={locale} locale={locale} lessonNumber="01" entrySource="overview" onExit={()=>{}}
      questions={Array.from({length:36},(_,i)=>({id:'q'+i,prompt:'Question '+(i+1)+' — '+('A detailed question about what you have learned. ').repeat(4),referenceAnswer:('Reference explanation and supporting examples. ').repeat(150)}))}
      initialAttempt={{kind:'knowledge',phase:'result',index:0,responses:Array.from({length:36},()=>({answer:('Actual saved learner answer. ').repeat(60),rating:'right'}))}}/>);
  ` }, bundle: true, write: false, outfile: "review.js", platform: "browser", jsx: "automatic", loader: { ".css": "local-css" },
    plugins: [{ name: "image", setup(builder) {
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: "image", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "import React from 'react';export default function Image(props){return <img {...props}/>}", loader: "tsx", resolveDir: process.cwd() }));
    } }] });
  const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] }); await mkdir("test-results/knowledge-review-scroll", { recursive: true });
  try {
    for (const locale of ["en-GB", "zh-CN"] as const) for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: width === 390 ? 560 : 900 } });
      const copy = getMessages(locale).knowledgeTest;
      await page.route("http://review.test/**", async route => {
        const url = new URL(route.request().url());
        return url.pathname.startsWith("/portal/") ? route.fulfill({ contentType: "image/svg+xml", body: await readFile(path.join("public", url.pathname)) })
          : route.fulfill({ contentType: "text/html", body: '<main style="height:3000px"><div id="root"></div></main>' });
      });
      await page.goto("http://review.test/");
      await page.addStyleTag({ content: await readFile("app/styles.css", "utf8") });
      await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith("css"))!.text });
      await page.addScriptTag({ content: "window.__name=value=>value" });
      await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith("js"))!.text });
      await page.evaluate(locale => (window as any).mount(locale), locale);
      const dialog = page.getByRole("dialog"), list = page.locator('[data-knowledge-result-list="strong"]');
      await expect(list).toBeVisible();
      const size = await list.evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight, bar: (element as HTMLElement).offsetWidth - element.clientWidth, display: getComputedStyle(element, "::-webkit-scrollbar").display, width: getComputedStyle(element).scrollbarWidth }));
      assert(size.scroll > size.client + 100); assert(size.bar > 2, "native scrollbar reserves a draggable track");
      assert.notEqual(size.display, "none"); assert.notEqual(size.width, "none");
      await list.hover(); await page.mouse.wheel(0, 380); await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
      const down = await list.evaluate(element => element.scrollTop);
      await page.mouse.wheel(0, -180); await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeLessThan(down);
      await list.evaluate(element => { element.scrollTop = 0; });
      const box = (await list.boundingBox())!, thumb = Math.max(18, box.height * size.client / size.scroll);
      await page.screenshot({ path: `test-results/knowledge-review-scroll/${locale}-${width}-track.png` });
      await page.mouse.move(box.x + box.width - 7, box.y + 16 + thumb / 2); await page.mouse.down();
      await page.mouse.move(box.x + box.width - 7, box.y + box.height - 15, { steps: 10 }); await page.mouse.up();
      await expect.poll(() => list.evaluate(element => element.scrollTop), { message: JSON.stringify({ locale, width, box, size, thumb }) }).toBeGreaterThan(size.client);
      assert.equal(await page.evaluate(() => window.scrollY), 0, "modal scrolling leaves the background fixed");
      await page.screenshot({ path: `test-results/knowledge-review-scroll/${locale}-${width}-results.png` });
      const card = list.locator("button").nth(20); await card.scrollIntoViewIfNeeded();
      const saved = await list.evaluate(element => element.scrollTop); await card.click();
      const body = page.locator('[data-knowledge-body="detail"]'); await expect(body).toBeVisible();
      const answer = body.locator("div").filter({ hasText: /^Actual saved learner answer/ }).first();
      await answer.hover(); await page.mouse.wheel(0, 240);
      await expect.poll(() => answer.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      assert.notEqual(await answer.evaluate(element => getComputedStyle(element).scrollbarWidth), "none");
      await body.locator("h3").hover(); await page.mouse.wheel(0, 500);
      await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      const back = dialog.getByRole("button", { name: copy.backToResults, exact: true }); await back.scrollIntoViewIfNeeded();
      await expect(back).toBeVisible(); await page.screenshot({ path: `test-results/knowledge-review-scroll/${locale}-${width}-detail.png` });
      await back.click(); await expect(list).toBeVisible();
      await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(saved);
      await page.close();
    }
  } finally { await browser.close(); }
});

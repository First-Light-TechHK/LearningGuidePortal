import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

test("Overview renders both catalogue lists, learning progress, protected links and bilingual mobile states", async () => {
  const bundle = await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {LearningOverview} from './components/portal/LearningOverview';import {AccountNav} from './components/portal/AccountNav';import {getMessages} from './lib/i18n/messages';import styles from './components/portal/learning-overview.module.css';const root=createRoot(document.getElementById('root'));window.mount=props=>root.render(<main className={'portal-page portal-account-page '+styles.page}><header className="portal-header" style={{height:68}}>Learning Guide</header><AccountNav locale={props.locale} copy={getMessages(props.locale).account}/><LearningOverview {...props}/></main>);`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, outfile: "overview.js", platform: "browser", external: ["/portal/*"], jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "next", setup(builder) {
      builder.onResolve({ filter: /^next\/(image|link|navigation)$/ }, args => ({ path: args.path, namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ resolveDir: process.cwd(), contents: args.path === "next/navigation" ? `export function usePathname(){return location.pathname}` : args.path === "next/link" ? `import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/ >}` : `import React from 'react';export default function Image({unoptimized,...props}){return <img {...props}/ >}`, loader: "tsx" }));
    } }],
  });
  const browser = await chromium.launch();
  await mkdir("test-results/learning-overview", { recursive: true });
  const identities = ["Horace: The Odes", "Quintus Horatius Flaccus", "A long course title covering science and its history"].map((title, index) => ({ courseId: `course-${index}`, slug: `slug-${index}`, title, category: "Science", cover: "/portal/course-book.jpg" }));
  const display = { learning: identities.map((course, index) => ({ ...course, kind: "learning", mode: index % 2 ? "text" : "video", progress: [46, 100, 0][index], currentLesson: index === 1 ? null : 4, currentLessonId: "lesson-4" })), previewed: identities.map(course => ({ ...course, kind: "preview" })) };
  try {
    for (const locale of ["en-GB", "zh-CN"]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1333 } });
      await page.route("http://overview.test/**", async route => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith("/portal/")) return route.fulfill({ body: await readFile(path.join("public", url.pathname)), contentType: url.pathname.endsWith("svg") ? "image/svg+xml" : "image/jpeg" });
        return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      });
      await page.goto(`http://overview.test/${locale}/account/my-learning`);
      for (const file of ["app/styles.css", "app/portal-design.css"]) await page.addStyleTag({ content: await readFile(file, "utf8") });
      await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith("css"))!.text });
      for (const weight of [400, 500, 600, 700]) {
        const font = (await readFile(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`)).toString("base64");
        await page.addStyleTag({ content: `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font});font-weight:${weight}}` });
      }
      await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith("js"))!.text });
      const mount = (data: unknown) => page.evaluate(props => (window as unknown as {mount:(props:unknown)=>void}).mount(props), { locale, name: "Selwyn", display: data });
      await mount(display);
      await page.locator("[data-learning-courses]").waitFor();
      assert.equal(await page.locator("[data-learning-courses] article").count(), 3);
      assert.equal(await page.locator("[data-previewed-courses] article").count(), 3);
      assert.equal(await page.locator("[data-previewed-courses] [role=progressbar]").count(), 0);
      assert.deepEqual(await page.getByRole("progressbar").evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-valuenow"))), ["46", "100", "0"]);
      assert.equal(await page.locator("[data-learning-courses] a").first().getAttribute("href"), `/${locale}/account/learn/course-0?viewMode=video&lessonId=lesson-4`);
      assert.equal(await page.locator("[data-previewed-courses] a").first().getAttribute("href"), `/${locale}/portal/courses/course-0`);
      await page.screenshot({ path: `test-results/learning-overview/${locale}-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `test-results/learning-overview/${locale}-mobile.png`, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await mount({ learning: [], previewed: [] });
      await page.locator("[data-learning-courses]").waitFor({ state: "detached" });
      assert.equal(await page.getByRole("progressbar").count(), 0);
      assert.equal(await page.locator('a[href$="/portal/courses"]').count(), 2);
      await page.close();
    }
  } finally { await browser.close(); }
});

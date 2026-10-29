import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getMessages } from "../../lib/i18n/messages";

test("Exploration uses real Next Image to load authenticated and redirected exhibit thumbnails directly", async () => {
  // Keep next/image real: replacing it with plain img concealed optimizer failures.
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ExplorationDialog} from './components/portal/ExplorationDialog';const root=createRoot(document.getElementById('root'));window.mount=props=>root.render(<ExplorationDialog {...props} onClose={()=>{}} onAskTutor={()=>{}}/>);` }, bundle: true, write: false, outfile: "exploration-thumbnails.js", platform: "browser", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env": "{}", "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "unused-model-pdf", setup(builder) {
    builder.onResolve({ filter: /Course(Model|Pdf)Preview$/ }, args => ({ path: args.path, namespace: "unused-preview" }));
    builder.onLoad({ filter: /.*/, namespace: "unused-preview" }, () => ({ contents: "export const CourseModelPreview=()=>null;export const CoursePdfPreview=()=>null" }));
  } }] });
  const mediaRequests: string[] = [], optimizerRequests: string[] = [], authenticated: boolean[] = [];
  const images = await Promise.all([1, 2].map(number => readFile(`public/courses/modeling-life/lesson1-exhibit-${number}-s.png`)));
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url!, "http://localhost").pathname;
    if (pathname === "/_next/image") { optimizerRequests.push(request.url!); response.writeHead(400); response.end("Internal image response is invalid"); return; }
    if (pathname.startsWith("/api/course-media/")) {
      mediaRequests.push(pathname); authenticated.push((request.headers.cookie || "").includes("thumbnail-session=signed-in-test-user"));
      if (pathname.endsWith("thumbnail-2")) { response.writeHead(307, { Location: "/fixtures/thumbnail-2.png" }); response.end(); return; }
      response.writeHead(200, { "Content-Type": "image/png" }); response.end(images[0]); return;
    }
    if (pathname === "/fixtures/thumbnail-2.png") { response.writeHead(200, { "Content-Type": "image/png" }); response.end(images[1]); return; }
    if (pathname.startsWith("/portal/")) { response.writeHead(200, { "Content-Type": "image/svg+xml" }); response.end(await readFile(`public${pathname}`)); return; }
    response.writeHead(200, { "Content-Type": "text/html" }); response.end('<div id="root"></div>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, browser = await chromium.launch();
  await mkdir("test-results/exploration-thumbnails", { recursive: true });
  try {
    for (const locale of ["en-GB", "zh-CN"] as const) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } }), page = await context.newPage();
      await context.addCookies([{ name: "thumbnail-session", value: "signed-in-test-user", url: origin }]);
      mediaRequests.length = 0; optimizerRequests.length = 0; authenticated.length = 0;
      const network: string[] = [];
      page.on("response", response => network.push(`${new URL(response.url()).pathname}:${response.status()}`));
      page.on("requestfailed", request => network.push(`${new URL(request.url()).pathname}:${request.failure()?.errorText}`));
      await page.goto(origin);
      await page.addScriptTag({ content: "window.__name=value=>value" });
      await page.addStyleTag({ content: await readFile("app/portal-design.css", "utf8") });
      await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith(".css"))!.text });
      await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text });
      const exhibits = [1, 2].flatMap(lesson => [1, 2].map(number => ({ node: { id: `exhibit-${lesson}-${number}`, title: number === 1 ? "T, W, V, C" : "Three examples of one-dimensional state spaces", type: "image", triggerTime: number === 1 ? 37 : 160, url: `/api/course-media/modeling-life/original-${number}`, thumbnail: `/api/course-media/modeling-life/thumbnail-${number}` }, thumbnail: `/api/course-media/modeling-life/thumbnail-${number}`, lessonNumber: `0${lesson}` })));
      await page.evaluate(props => (window as any).mount(props), { locale, courseId: "modeling-life", data: { readings: [], exhibits }, lessons: [{ number: "01", title: "Lesson 1", unlocked: true }, { number: "02", title: "Lesson 2", unlocked: true }] });
      const dialog = page.getByRole("dialog"), copy = getMessages(locale).exploration;
      await dialog.getByRole("tab", { name: copy.exhibits, exact: true }).click();
      const thumbnails = dialog.locator("[data-exhibit-id] > img:first-child");
      async function verify(count: number) {
        assert.equal(await thumbnails.count(), count);
        for (const thumbnail of await thumbnails.all()) {
          assert.match((await thumbnail.getAttribute("src"))!, /^\/api\/course-media\/modeling-life\/thumbnail-[12]$/);
          assert.equal(await thumbnail.getAttribute("srcset"), null, "private images bypass the shared optimizer");
          assert.equal(await thumbnail.evaluate(async image => { await (image as HTMLImageElement).decode(); return (image as HTMLImageElement).naturalWidth > 0; }).catch(error => { throw new Error(`${error.message}; ${network.join(", ")}`); }), true);
          assert.deepEqual(await thumbnail.evaluate(image => ({ width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height })), { width: 56, height: 56 });
        }
      }
      await verify(2);
      assert.ok(mediaRequests.includes("/api/course-media/modeling-life/thumbnail-1"));
      assert.ok(mediaRequests.includes("/api/course-media/modeling-life/thumbnail-2"));
      await dialog.getByRole("button", { name: copy.wholeCourse, exact: true }).click(); await verify(4);
      await page.screenshot({ path: `test-results/exploration-thumbnails/${locale}-desktop.png` });
      await page.setViewportSize({ width: 390, height: 844 }); await verify(4);
      await page.screenshot({ path: `test-results/exploration-thumbnails/${locale}-mobile.png` });
      assert.deepEqual(optimizerRequests, [], "exhibit thumbnails never go through /_next/image");
      assert.ok(authenticated.length > 0 && authenticated.every(Boolean), "browser thumbnail requests retain the session cookie");
      await context.close();
    }
  } finally { await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

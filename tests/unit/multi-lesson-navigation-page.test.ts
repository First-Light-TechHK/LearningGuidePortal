import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { previewLessonOutline } from "../../lib/previewLessonPresentation";
import type { ProductCourse } from "../../services/productStore";
import { getMessages } from "../../lib/i18n/messages";

test("three lessons remain reachable across text/video changes, with locked and empty lessons retained", async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PreviewLessonView} from './components/portal/PreviewLessonView';const root=createRoot(document.getElementById('root'));window.mount=p=>flushSync(()=>root.render(<PreviewLessonView key={p.lesson.id} {...p}/>));` },
    bundle: true, write: false, outfile: "lesson.js", platform: "browser", jsx: "automatic", loader: { ".css": "local-css" },
    plugins: [{ name: "next", setup(builder) {
      builder.onResolve({ filter: /Course(Model|Pdf)Preview$/ }, args => ({ path: args.path, namespace: "unrelated" }));
      builder.onLoad({ filter: /.*/, namespace: "unrelated" }, () => ({ contents: "export const CourseModelPreview=()=>null;export const CoursePdfPreview=()=>null;" }));
      builder.onResolve({ filter: /^next\/(image|link|navigation|dynamic)$/ }, args => ({ path: args.path, namespace: "next" }));
      builder.onLoad({ filter: /.*/, namespace: "next" }, args => ({ resolveDir: process.cwd(), loader: "tsx", contents:
        args.path === "next/navigation" ? "const router={push(href){window.destination=href},refresh(){}};export const useRouter=()=>router;"
          : args.path === "next/dynamic" ? "export default function dynamic(){return ()=>null;}"
            : args.path === "next/link" ? "import React from 'react';export default function Link({prefetch,...p}){return <a {...p}/>;}"
              : "import React from 'react';export default function Image({unoptimized,...p}){return <img {...p}/>;}" }));
    } }],
  });
  const browser = await chromium.launch();
  try {
    for (const locale of ["en-GB", "zh-CN"] as const) {
      const page = await browser.newPage();
      let failMode = false;
      const saves: Array<{ mode: string }> = [];
      await page.route("http://lessons.test/**", async route => {
        if (route.request().url().includes("/api/")) {
          if (route.request().url().endsWith("/learning-mode")) {
            saves.push(route.request().postDataJSON());
            // A different saved cursor must never override an explicit lesson click.
            return route.fulfill({ status: failMode ? 503 : 200, json: { ok: !failMode, data: { position: { lessonId: "third", contentId: "third-video" } } } });
          }
          return route.fulfill({ json: { ok: true } });
        }
        if (new URL(route.request().url()).pathname === "/") return route.fulfill({ contentType: "text/html", body: "<div id='root'></div>" });
        return route.fulfill({ status: 404, body: "" });
      });
      await page.goto("http://lessons.test/");
      await page.addScriptTag({ content: "window.__name=value=>value;window.destination=null" });
      await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text });
      const lessons = [
        { id: "first", title: "Earlier text lesson", body: "", durationMinutes: 1, contents: [{ id: "first-text", title: "Reading", type: "text", mode: "lecture", html: "<p>Reading</p>", nodes: [] }] },
        { id: "second", title: "Second video lesson", body: "", durationMinutes: 1, contents: [{ id: "second-video", title: "Video", type: "video", mode: "lecture", url: "/missing.mp4", nodes: [] }] },
        { id: "third", title: "Third mixed lesson", body: "", durationMinutes: 1, contents: [{ id: "third-text", title: "Reading", type: "text", mode: "lecture", html: "<p>Reading</p>", nodes: [] }, { id: "third-video", title: "Video", type: "video", mode: "lecture", url: "/missing.mp4", nodes: [] }] },
        { id: "empty", title: "Missing content lesson", body: "", durationMinutes: 1, contents: [] },
      ];
      const outline = previewLessonOutline({ id: "course", sections: [{ lessons }] } as unknown as ProductCourse, locale, true);
      outline.push({ id: "locked", title: "Locked lesson", number: "05", modes: ["text"], href: null });
      const mount = async (index: number, mode: string) => {
        await page.evaluate(props => (window as unknown as { mount: (p: unknown) => void }).mount(props), {
          locale, courseId: "course", courseTitle: "Three lessons", category: "", description: "", lesson: lessons[index], outline,
          poster: "", entitled: true, tutorOnline: false, initialCompleted: false, nextHref: null, preferredMode: mode, studyEndpoint: "/api/study/events",
        });
      };
      const menu = page.getByRole("navigation", { name: getMessages(locale).previewVideoDesign.outline });
      for (const [index, mode] of [[0, "text"], [1, "video"], [2, "video"], [0, "text"]] as const) {
        await mount(index, mode);
        assert.equal(await menu.getByRole("link").count(), 3);
        assert.equal(await menu.locator('[aria-disabled="true"]').count(), 2);
        assert.ok((await menu.getByRole("link", { name: /Earlier text lesson/ }).getAttribute("href"))?.includes("viewMode=text"));
        assert.ok((await menu.getByRole("link", { name: /Second video lesson/ }).getAttribute("href"))?.includes("viewMode=video"));
        assert.equal(await menu.getByText("Missing content lesson", { exact: false }).getAttribute("title"), getMessages(locale).previewVideoDesign.lessonUnavailable);
      }
      failMode = true;
      await menu.getByRole("link", { name: /Second video lesson/ }).click();
      await page.getByText(getMessages(locale).courseLearningMode.saveError, { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => (window as unknown as { destination: string | null }).destination), null);
      failMode = false;
      await menu.getByRole("link", { name: /Second video lesson/ }).click();
      await page.waitForFunction(() => Boolean((window as unknown as { destination: string | null }).destination));
      const destination = await page.evaluate(() => (window as unknown as { destination: string }).destination);
      assert.ok(destination.includes("lessonId=second&viewMode=video"));
      assert.deepEqual(saves.map(save => save.mode), ["video", "video"]);
      await page.close();
    }
  } finally { await browser.close(); }
});

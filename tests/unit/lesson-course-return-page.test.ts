import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isolate, setCookie, SESSION_COOKIE } from "../io/harness";
import { lessonBookmarkContext } from "../../services/lessonBookmarkPolicy";

test("Course breadcrumb waits for the latest text/video checkpoint before a fresh Course detail read", async () => {
  const root = process.cwd();
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {PreviewLessonView} from './components/portal/PreviewLessonView';window.mount=props=>createRoot(document.getElementById('root')).render(<PreviewLessonView {...props}/>);` },
    bundle: true, write: false, outfile: "return.js", platform: "browser", jsx: "automatic", loader: { ".css": "local-css", ".woff2": "dataurl" }, external: ["/portal/*"],
    plugins: [{ name: "next", setup(builder) {
      builder.onResolve({ filter: /Course(Model|Pdf)Preview$/ }, args => ({ path: args.path, namespace: "mock" }));
      builder.onResolve({ filter: /^next\// }, args => ({ path: args.path, namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ loader: "tsx", resolveDir: root, contents:
        args.path.endsWith("Preview") ? "export const CourseModelPreview=()=>null;export const CoursePdfPreview=()=>null"
          : args.path === "next/navigation" ? "export const useRouter=()=>({refresh(){},push(){}})"
          : args.path === "next/dynamic" ? "export default ()=>()=>null"
          : "import React from 'react';export default function Component({prefetch,unoptimized,...props}){return props.src?<img {...props}/>:<a {...props}/>}" }));
    } }],
  });
  const { restore } = await isolate("lesson-course-return-");
  const browser = await chromium.launch();
  const pendingWrites: Promise<unknown>[] = [];
  try {
    const store = await import("../../services/productStore");
    const bookmarkRoute = await import("../../app/api/study/bookmarks/route");
    const course = (await store.getProductCourse("modeling-life"))!;
    const lesson = course.sections.flatMap(section => section.lessons)[1];
    for (const locale of ["en-GB", "zh-CN"] as const) for (const mode of ["text", "video"] as const) {
      const user = await store.registerUser({ email: `return-${locale}-${mode}@example.test`, password: "password1" });
      await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
      setCookie(SESSION_COOKIE, (await store.createSession(user.id)).token);
      const { quote } = await store.createQuote(user.id, "everything-pc-6");
      await store.completeDemoCheckout(user.id, quote.id);
      const points = lesson.contents!.filter(content => content.active !== false && (mode === "text" ? content.type !== "video" : content.type === "video"));
      await store.saveLessonBookmark(user.id, { courseId: course.id, lessonId: lesson.id, mode, contentId: points[0].id,
        ...(mode === "text" ? { paragraphId: `${points[0].id}:paragraph:0` } : { positionMs: 0 }),
        contentVersion: lessonBookmarkContext(course, lesson.id, mode).contentVersion, expectedRevision: 0, expectedLessonRevision: 0, clientEventId: `initial-${locale}-${mode}` });
      const readBookmark = async () => (await store.getLessonBookmarks(user.id, course.id)).bookmarks[lesson.id][mode]!;
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const lessonUrl = `http://course-return.test/${locale}/account/learn/${course.id}?lessonId=${lesson.id}`;
      const courseUrl = `http://course-return.test/${locale}/portal/courses/${course.id}`;
      const breadcrumb = page.locator(`[data-lesson-breadcrumb] a[href="/${locale}/portal/courses/${course.id}"]`);
      const scrollToParagraph = (point: number, paragraph: number) => page.locator(`[data-text-point-id="${points[point].id}"] .la-prose p`).nth(paragraph)
        .evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + scrollY - (document.querySelector("[data-reading-toolbar]")?.getBoundingClientRect().height || 0) + 2));
      let delaySave = false, failSave = false, committedAt = 0, readAt = 0;
      await page.route("http://course-return.test/**", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname === "/api/study/bookmarks") {
          const task = (async () => {
            if (delaySave) await new Promise(resolve => setTimeout(resolve, 1500));
            if (failSave) return route.fulfill({ status: 503, json: { ok: false } }).catch(() => undefined);
            const response = await bookmarkRoute.POST(new Request(request.url(), { method: "POST", headers: { "Content-Type": "application/json", origin: url.origin }, body: request.postData() }));
            if (response.ok) committedAt = Date.now();
            return route.fulfill({ status: response.status, json: await response.json() }).catch(() => undefined);
          })();
          pendingWrites.push(task);
          return task;
        }
        if (request.url() === courseUrl) {
          const current = await store.getLessonBookmarks(user.id, course.id);
          readAt = Date.now();
          return route.fulfill({ contentType: "text/html", body: `<h1>Course detail</h1><p data-server-lp>${current.bookmarks[lesson.id][mode]!.lpNumber}</p>` });
        }
        if (url.pathname.startsWith("/api/")) return route.fulfill({ json: { ok: true } });
        if (url.pathname.startsWith("/portal/")) return route.fulfill({ body: await readFile(path.join(root, "public", url.pathname)) });
        return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      });
      const mount = async () => {
        const snapshot = await store.getLessonBookmarks(user.id, course.id);
        await page.goto(lessonUrl);
        for (const file of ["app/styles.css", "app/portal-design.css"]) await page.addStyleTag({ content: await readFile(path.join(root, file), "utf8") });
        await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith(".css"))!.text });
        await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text });
        await page.evaluate(props => (window as any).mount(props), { locale, courseId: course.id, courseTitle: course.title, category: "Science", description: "", lesson,
          outline: [{ id: lesson.id, number: "02", title: lesson.title, href: lessonUrl, modes: ["text", "video"] }], poster: "", entitled: true, tutorOnline: false,
          preferredMode: mode, initialContentId: snapshot.bookmarks[lesson.id][mode]!.contentId, bookmarkRestore: "lp", bookmarkSnapshot: snapshot, bookmarkOwnerId: user.id, nextHref: null });
        if (mode === "text") {
          await page.locator('[data-bookmark-ready="true"]').waitFor();
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
        } else {
          await page.locator("video").evaluate(element => {
            Object.defineProperty(element, "duration", { configurable: true, value: 3000 });
            Object.defineProperty(element, "readyState", { configurable: true, value: 4 });
            element.dispatchEvent(new Event("loadedmetadata"));
          });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        }
      };
      await mount();
      delaySave = true;
      if (mode === "text") {
        const writing = page.waitForRequest(request => new URL(request.url()).pathname === "/api/study/bookmarks");
        await scrollToParagraph(1, 3);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        // Clicking the real link scrolls the page back up before the reading debounce finishes.
        await breadcrumb.click();
        const position = (await writing).postDataJSON();
        assert.equal(position.contentId, points[1].id);
      } else {
        // A breadcrumb must also capture a paused video's current position between periodic writes.
        await page.locator("video").evaluate((element, seconds) => { (element as HTMLVideoElement).currentTime = seconds; }, (points[1].startSeconds || 0) + 10);
        await breadcrumb.click();
      }
      await page.waitForURL(courseUrl);
      assert.equal(await page.locator("[data-server-lp]").textContent(), "2.2", `${locale}/${mode}: first Course detail render includes the just-saved checkpoint`);
      assert.ok(readAt >= committedAt && committedAt > 0);
      let latest = await readBookmark();
      if (mode === "video") assert.equal(latest.positionMs, ((points[1].startSeconds || 0) + 10) * 1000);
      delaySave = false;
      if (mode === "text") {
        assert.notEqual(latest.paragraphId, `${points[1].id}:paragraph:0`);
        const before = pendingWrites.length;
        await mount();
        const barHeight = await page.locator("[data-reading-toolbar]").evaluate(element => element.getBoundingClientRect().height);
        const headingTop = await page.locator(`[data-text-point-id="${points[1].id}"]`).evaluate(element => element.getBoundingClientRect().top);
        assert.ok(Math.abs(headingTop - barHeight - 12) < 3, "reentry still restores the LP heading");
        await page.evaluate(() => window.scrollTo(0, 0));
        await breadcrumb.click();
        await page.waitForURL(courseUrl);
        assert.equal(pendingWrites.length, before, `reentry and returning to the breadcrumb must not write a new checkpoint: ${JSON.stringify({before:latest,after:await readBookmark()})}`);
        assert.deepEqual(await readBookmark(), latest);

        await mount();
        const reread = page.waitForResponse(response => new URL(response.url()).pathname === "/api/study/bookmarks" && response.ok());
        await scrollToParagraph(0, 6);
        await reread;
        latest = await readBookmark();
        assert.equal(latest.lpNumber, "2.1", "intentional reading of an earlier point updates the bookmark");
        assert.notEqual(latest.paragraphId, `${points[0].id}:paragraph:0`);
        await breadcrumb.click();
        await page.waitForURL(courseUrl);
        assert.deepEqual(await readBookmark(), latest, "returning through the top does not replace the reread paragraph");
      }
      // A provider failure must not trap the learner or invent a saved checkpoint.
      failSave = true;
      await mount();
      if (mode === "text") {
        const failed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/study/bookmarks" && response.status() === 503);
        await scrollToParagraph(1, 6);
        await failed;
      }
      await breadcrumb.click();
      if (mode === "text") {
        await page.locator('[data-reading-toolbar] [role="alert"]').waitFor();
        assert.equal(page.url(), lessonUrl, "failed text saves offer an explicit choice before leaving");
        await page.getByRole("button", {name: (await import("../../lib/i18n/messages")).getMessages(locale).readingNavigation.leave, exact:true}).click();
      }
      await page.waitForURL(courseUrl);
      assert.equal(await page.locator("[data-server-lp]").textContent(), latest.lpNumber);
      assert.deepEqual(await readBookmark(), latest);
      await page.close();
    }
  } finally { await browser.close(); await Promise.allSettled(pendingWrites); await restore(); }
});

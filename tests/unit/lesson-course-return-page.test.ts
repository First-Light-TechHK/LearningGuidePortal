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
    bundle: true, write: false, outfile: "return.js", platform: "browser", jsx: "automatic", loader: { ".css": "local-css" }, external: ["/portal/*"],
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
      const snapshot = await store.getLessonBookmarks(user.id, course.id);
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const lessonUrl = `http://course-return.test/${locale}/account/learn/${course.id}?lessonId=${lesson.id}`;
      const courseUrl = `http://course-return.test/${locale}/portal/courses/${course.id}`;
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
        await page.goto(lessonUrl);
        for (const file of ["app/styles.css", "app/portal-design.css"]) await page.addStyleTag({ content: await readFile(path.join(root, file), "utf8") });
        await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith(".css"))!.text });
        await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text });
        await page.evaluate(props => (window as any).mount(props), { locale, courseId: course.id, courseTitle: course.title, category: "Science", description: "", lesson,
          outline: [{ id: lesson.id, number: "02", title: lesson.title, href: lessonUrl, modes: ["text", "video"] }], poster: "", entitled: true, tutorOnline: false,
          preferredMode: mode, initialContentId: points[0].id, bookmarkRestore: "lp", bookmarkSnapshot: snapshot, bookmarkOwnerId: user.id, nextHref: null });
        if (mode === "text") {
          await page.locator('[data-bookmark-ready="true"]').waitFor();
          await page.waitForLoadState("networkidle");
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
        await page.locator(`[data-text-point-id="${points[1].id}"] .la-prose p`).nth(3).evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + scrollY - 20));
      } else {
        // A breadcrumb must also capture a paused video's current position between periodic writes.
        await page.locator("video").evaluate((element, seconds) => { (element as HTMLVideoElement).currentTime = seconds; }, (points[1].startSeconds || 0) + 10);
      }
      // DOM click avoids scrolling the reading surface back to its breadcrumb before capture.
      await page.locator(`nav a[href="/${locale}/portal/courses/${course.id}"]`).evaluate(element => (element as HTMLElement).click());
      await page.waitForURL(courseUrl);
      assert.equal(await page.locator("[data-server-lp]").textContent(), "2.2", `${locale}/${mode}: first Course detail render includes the just-saved checkpoint`);
      assert.ok(readAt >= committedAt && committedAt > 0);
      const latest = (await store.getLessonBookmarks(user.id, course.id)).bookmarks[lesson.id][mode]!;
      if (mode === "video") assert.equal(latest.positionMs, ((points[1].startSeconds || 0) + 10) * 1000);
      // A provider failure must not trap the learner or invent a saved checkpoint.
      delaySave = false; failSave = true;
      await mount();
      await page.locator(`nav a[href="/${locale}/portal/courses/${course.id}"]`).evaluate(element => (element as HTMLElement).click());
      await page.waitForURL(courseUrl);
      assert.equal(await page.locator("[data-server-lp]").textContent(), "2.2");
      await page.close();
    }
  } finally { await browser.close(); await Promise.allSettled(pendingWrites); await restore(); }
});

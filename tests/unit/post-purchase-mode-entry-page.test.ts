import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isolate } from "../io/harness";
import { COURSE_ID, verifiedUser, purchaseCourse, writeProductData } from "./helpers/my-learning";
import { getMessages } from "../../lib/i18n/messages";
import { resolveLessonPresentation } from "../../lib/courseLearningMode";

test("after purchase both locales enter the chosen text/video Lesson through the real mode API", async () => {
  const root = process.cwd();
  const bundle = await build({ stdin: { resolveDir: root, loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {CourseLearningModeDialog} from './components/portal/CourseLearningModeDialog';window.mount=p=>createRoot(document.getElementById('root')).render(<CourseLearningModeDialog {...p}/>);` },
    bundle: true, write: false, outfile: "entry.js", platform: "browser", jsx: "automatic", external: ["/portal/*"], loader: { ".css": "local-css" }, plugins: [{ name: "next", setup(b) {
      b.onResolve({ filter: /^next\// }, a => ({ path: a.path, namespace: "next" }));
      b.onLoad({ filter: /.*/, namespace: "next" }, a => ({ resolveDir: root, loader: "tsx", contents: a.path === "next/navigation"
        ? "export const usePathname=()=>location.pathname;export const useRouter=()=>({push(url){window.destination=url},refresh(){window.refreshCount=(window.refreshCount||0)+1}})"
        : "import React from 'react';export default function Image(p){return <img {...p}/>}" }));
    } }] });
  const { restore } = await isolate("post-purchase-mode-entry-");
  const browser = await chromium.launch();
  try {
    const store = await import("../../services/productStore");
    const { PUT } = await import("../../app/api/courses/[courseId]/learning-mode/route");
    const data = await store.ensureProductData(), course = data.courses.find(course => course.id === COURSE_ID)!;
    const lessons = course.sections.flatMap((section: { lessons: any[] }) => section.lessons);
    lessons[0].body = ""; lessons[0].contents = [{ id: "reading", title: "Reading", type: "text", mode: "lecture", html: "<p>Reading</p>", nodes: [] }];
    lessons[1].body = ""; lessons[1].contents = [{ id: "video", title: "Video", type: "video", mode: "lecture", url: "/video.mp4", nodes: [] }];
    await writeProductData(data);
    const preview = await verifiedUser(store, "mode-entry-preview@example.test");
    const previewToken = (await store.createSession(preview.id)).token;
    const previewEntry = (input: unknown) => PUT(new Request(`http://localhost:3014/api/courses/${COURSE_ID}/learning-mode`, { method: "PUT", headers: { origin: "http://localhost:3014", cookie: `learning_guide_session=${previewToken}` }, body: JSON.stringify(input) }), { params: Promise.resolve({ courseId: COURSE_ID }) });
    assert.equal((await previewEntry({ mode: "text", intent: "entry", accessContext: "preview" })).status,400);
    assert.equal((await previewEntry({ mode: "video", lessonId: lessons[0].id, intent: "entry", accessContext: "preview" })).status,400,"a mode available only in private Lessons cannot enter through preview");
    assert.equal((await previewEntry({ mode: "video", lessonId: lessons[1].id, intent: "entry", accessContext: "preview" })).status,404);
    assert.equal(await store.getCourseLearningMode(preview.id,COURSE_ID),null,"failed entry cannot save an unusable preference");
    for (const locale of ["en-GB", "zh-CN"] as const) for (const mode of ["video", "text"] as const) {
      const user = await verifiedUser(store, `${locale}-${mode}@example.test`);
      await store.saveCourseLearningMode(user.id, COURSE_ID, "video");
      await purchaseCourse(store, user.id);
      assert.equal(await store.getCourseLearningMode(user.id, COURSE_ID), null);
      const token = (await store.createSession(user.id)).token;
      const page = await browser.newPage(); const writes: any[] = []; let fail = true;
      await page.route("http://localhost:3014/**", async route => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith("/api/courses/")) {
          const input = route.request().postDataJSON(); writes.push(input);
          if (fail) return route.fulfill({ status: 503, json: { ok: false } });
          const response = await PUT(new Request(route.request().url(), { method: "PUT", headers: { origin: url.origin, cookie: `learning_guide_session=${token}` }, body: JSON.stringify(input) }), { params: Promise.resolve({ courseId: COURSE_ID }) });
          return route.fulfill({ status: response.status, json: await response.json() });
        }
        if (url.pathname.startsWith("/portal/learning-mode/")) return route.fulfill({ contentType: "image/svg+xml", body: await readFile(path.join(root, "public", url.pathname)) });
        return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      });
      await page.goto(`http://localhost:3014/${locale}/portal/courses/${COURSE_ID}`);
      await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith("css"))!.text });
      await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith("js"))!.text });
      await page.evaluate(props => (window as any).mount(props), { courseId: COURSE_ID, locale, signedIn: true, accessContext: "entitled", destinationHref: `/${locale}/account/learn/${COURSE_ID}?lessonId=${lessons[0].id}` });
      const copy = getMessages(locale).courseLearningMode;
      await page.getByRole("radio", { name: mode === "video" ? copy.video : copy.text }).check();
      const proceed = page.getByRole("button", { name: mode === "video" ? copy.continueVideo : copy.continueText, exact: true });
      await proceed.click(); await page.getByRole("alert").waitFor();
      assert.equal(await page.evaluate(() => (window as any).destination), undefined);
      fail = false; await proceed.click(); await page.waitForFunction(() => Boolean((window as any).destination));
      const destination = new URL(await page.evaluate(() => (window as any).destination), "http://localhost:3014");
      assert.equal(destination.pathname, `/${locale}/account/learn/${COURSE_ID}`);
      assert.equal(destination.searchParams.get("viewMode"), mode);
      assert.equal(destination.searchParams.get("modeSwitch"), "1");
      const lesson = lessons.find((lesson: { id: string }) => lesson.id === destination.searchParams.get("lessonId"));
      assert.equal(lesson.id, lessons[mode === "text" ? 0 : 1].id);
      assert.equal(resolveLessonPresentation(lesson.contents, mode, destination.searchParams.get("contentId")).mode, mode);
      assert.equal(await store.getCourseLearningMode(user.id, COURSE_ID), mode);
      assert.deepEqual(writes[0], writes[1], "retry retains the original entry intent");
      assert.equal(await page.evaluate(() => (window as any).refreshCount || 0), 0, "success navigates to Study rather than refreshing Course detail");
      await page.close();
    }
  } finally { await browser.close(); await restore(); }
});

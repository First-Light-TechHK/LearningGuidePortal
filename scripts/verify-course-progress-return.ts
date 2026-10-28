import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { getMessages } from "../lib/i18n/messages";

// Real production Next history navigation; all Users/Orders/Study data are disposable.
async function main() {
  const repo = process.cwd(), environment = { ...process.env }, dist = process.env.NEXT_DIST_DIR || ".next-course-resume-check";
  await readFile(path.join(repo, dist, "BUILD_ID"));
  const probe = createServer();await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as { port: number }).port, origin = `http://127.0.0.1:${port}`;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const temporary = await mkdtemp(path.join(tmpdir(), "lg-course-progress-"));
  const output = path.join(repo, "test-results/course-progress-return");await mkdir(output, { recursive: true });
  Object.assign(process.env, {
    STORAGE_BACKEND: "local", APP_ENV: "DEV", PAYMENT_MODE: "demo", LOCAL_SOCIAL_LOGIN: "0",
    DATABASE_URL: "", DATA_S3_BUCKET: "", KS_TUTOR_BASE_URL: "", NEXT_DIST_DIR: dist,
    NEXT_PUBLIC_APP_URL: origin, SESSION_SECRET: "course-progress-disposable-test-secret",
  });
  process.chdir(temporary);
  let server: ReturnType<typeof spawn> | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const store = await import("../services/productStore");
    const course = await store.getProductCourse("modeling-life");assert.ok(course);
    const lessons = course.sections.flatMap(section => section.lessons), second = lessons[1];
    const point = second.contents!.find(content => content.type === "video")!;
    const users = [];
    for (const locale of ["en-GB", "zh-CN"] as const) {
      const email = `resume-${locale.toLowerCase()}@example.test`, password = "Local-password1";
      const user = await store.registerUser({ email, password, nickname: "Resume Learner" });
      await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
      const { quote } = await store.createQuote(user.id, "science-pc-6");await store.completeDemoCheckout(user.id, quote.id);
      await store.saveCourseLearningMode(user.id, course.id, "video");
      users.push({ user, locale, email, password });
    }
    server = spawn(process.execPath, [path.join(repo, "node_modules/next/dist/bin/next"), "start", repo, "-p", String(port), "--hostname", "127.0.0.1"], { cwd: temporary, env: process.env, windowsHide: true, stdio: "ignore" });
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { if ((await fetch(`${origin}/en-GB/portal`, { signal: AbortSignal.timeout(2000) })).ok) { ready = true;break; } } catch { /* Wait for the isolated server. */ }
      if (server.exitCode !== null) throw new Error("Isolated Next server stopped");
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready);browser = await chromium.launch();
    for (const { locale, email, password } of users) {
      const context = await browser.newContext(), page = await context.newPage(), copy = getMessages(locale).courseDetailDesign;
      await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      assert.equal((await context.request.post(`${origin}/api/auth/login`, { data: { email, password } })).status(), 200);
      const target = `${origin}/${locale}/portal/courses/${course.slug}`;
      const start = page.locator('[data-syllabus] [data-course-cta-link="continue_learning"]');
      const expected: string = `/${locale}/account/learn/${course.id}?lessonId=${second.id}`;
      await page.goto(target);await start.waitFor();
      assert.equal(await start.getAttribute("href"), `/${locale}/account/learn/${course.id}?lessonId=${lessons[0].id}`);
      // Keep a first-Lesson snapshot in Next's client-router history.
      await page.locator("header .portal-brand").click();await page.waitForURL(`${origin}/${locale}/portal`);
      await page.waitForLoadState("networkidle");
      const saved = await context.request.post(`${origin}/api/study/events`, { data: { courseId: course.id, lessonId: second.id, contentId: point.id, learningMode: "video", event: "open", seconds: 0, clientEventId: randomUUID() } });
      assert.equal(saved.status(), 200);assert.equal((await saved.json()).record.progress, 86);
      const firstPoint = lessons[0].contents!.find(content => content.type === "video")!;
      const reviewed = await context.request.post(`${origin}/api/study/events`, { data: { courseId: course.id, lessonId: lessons[0].id, contentId: firstPoint.id, learningMode: "video", event: "open", seconds: 0, clientEventId: randomUUID() } });
      const reviewRecord = (await reviewed.json()).record;
      assert.equal(reviewed.status(), 200);assert.equal(reviewRecord.progress, 86);assert.equal(reviewRecord.currentLessonId, lessons[0].id);
      assert.equal(reviewRecord.highestProgress.lessonId, second.id);assert.equal(reviewRecord.highestProgress.progress, 86);
      const current = await context.request.get(`${origin}/api/portal/courses/${course.slug}`);
      assert.equal((await current.json()).page.actionLessonId, second.id, "Start follows the highest progress despite reviewing Lesson 1");
      assert.equal(current.headers()["cache-control"], "private, no-store");assert.ok(current.headers().vary.split(/,\s*/).includes("Cookie"));
      await page.goBack();await start.waitFor();await page.waitForLoadState("networkidle");
      await page.waitForFunction(expected => document.querySelector('[data-syllabus] [data-course-cta-link="continue_learning"]')?.getAttribute("href") === expected, expected, { timeout: 10000 });
      assert.equal(await start.textContent(), copy.start);
      assert.equal(await page.locator('[data-course-plan-status="included"] a').getAttribute("href"), expected);
      assert.equal(await page.locator(`[data-lesson-id="${lessons[0].id}"] [data-course-cta-link]`).count(), 0);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.screenshot({ path: path.join(output, `${locale}-${width}.png`), fullPage: true });
      }
      await start.click();await page.waitForURL(origin + expected);
      await page.getByRole("heading", { name: second.title, exact: true }).waitFor();
      await context.close();
    }
    console.log("PASS: Modeling life highest 86% keeps Start on Lesson 2 after reviewing Lesson 1 and restoring Next history in both locales.");
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) { const stopped = new Promise<void>(resolve => server!.once("exit", () => resolve()));server.kill();await stopped; }
    process.chdir(repo);process.env = environment;
    if (path.dirname(temporary) === tmpdir() && path.basename(temporary).startsWith("lg-course-progress-")) await rm(temporary, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error);process.exitCode = 1; });

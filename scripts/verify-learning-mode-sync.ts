import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { getMessages } from "../lib/i18n/messages";

async function main() {
  const repo = process.cwd(), environment = { ...process.env }, dist = process.env.NEXT_DIST_DIR || ".next-mode-sync-check";
  await readFile(path.join(repo, dist, "BUILD_ID"));
  const probe = createServer();await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as { port: number }).port, origin = `http://127.0.0.1:${port}`;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const temporary = await mkdtemp(path.join(tmpdir(), "lg-mode-sync-")), output = path.join(repo, "test-results/learning-mode-sync");
  await mkdir(output, { recursive: true });
  Object.assign(process.env, { STORAGE_BACKEND: "local", APP_ENV: "DEV", PAYMENT_MODE: "demo", LOCAL_SOCIAL_LOGIN: "0", DATABASE_URL: "", DATA_S3_BUCKET: "", KS_TUTOR_BASE_URL: "", NEXT_DIST_DIR: dist, NEXT_PUBLIC_APP_URL: origin, SESSION_SECRET: "mode-sync-disposable-session-secret" });
  process.chdir(temporary);
  let server: ReturnType<typeof spawn> | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const store = await import("../services/productStore"), course = await store.getProductCourse("modeling-life");assert.ok(course);
    const lesson = course.sections[0].lessons[1], text = lesson.contents!.find(content => content.type === "text")!;
    const users = [];
    for (const locale of ["en-GB", "zh-CN"] as const) {
      const email = `mode-${locale.toLowerCase()}@example.test`, password = "Local-password1";
      const user = await store.registerUser({ email, password, nickname: "Mode Learner" });
      await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
      const { quote } = await store.createQuote(user.id, "science-pc-6");await store.completeDemoCheckout(user.id, quote.id);
      await store.recordStudyEvent({ userId: user.id, courseId: course.id, lessonId: lesson.id, contentId: text.id, learningMode: "text", event: "open", seconds: 0, clientEventId: `initial-${locale}` });
      await store.saveCourseLearningMode(user.id, course.id, "text");
      users.push({ locale, email, password });
    }
    server = spawn(process.execPath, [path.join(repo, "node_modules/next/dist/bin/next"), "start", repo, "-p", String(port), "--hostname", "127.0.0.1"], { cwd: temporary, env: process.env, windowsHide: true, stdio: "ignore" });
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { if ((await fetch(`${origin}/en-GB/portal`, { signal: AbortSignal.timeout(2000) })).ok) { ready = true;break; } } catch { /* Isolated server starting. */ }
      if (server.exitCode !== null) throw new Error("Isolated Next server stopped");
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready);browser = await chromium.launch();
    for (const { locale, email, password } of users) {
      const context = await browser.newContext(), page = await context.newPage(), messages = getMessages(locale);
      await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      assert.equal((await context.request.post(`${origin}/api/auth/login`, { data: { email, password } })).status(), 200);
      const overview = `${origin}/${locale}/account/my-learning`, card = page.locator("[data-overview-course]");
      await page.goto(overview);await card.getByText(messages.overviewV1.text, { exact: true }).waitFor();
      const essentialCookies = page.getByRole("button", { name: messages.legal.rejectOptional, exact: true });
      if (await essentialCookies.isVisible()) await essentialCookies.click();
      for (const mode of ["video", "text"] as const) {
        await card.getByRole("link").click();await page.waitForURL(url => url.pathname.endsWith(`/account/learn/${course.id}`));
        const save = page.waitForResponse(response => response.url().endsWith("/learning-mode") && response.request().method() === "PUT");
        await page.getByRole("combobox", { name: messages.previewVideoDesign.learningMode }).selectOption(mode);
        assert.equal((await save).status(), 200);
        await page.waitForURL(url => url.searchParams.get("viewMode") === mode);await page.waitForLoadState("networkidle");
        if (mode === "video") assert.equal(await page.locator("video.la-lesson-video").evaluate(video => (video as HTMLVideoElement).paused), true);
        const response = await context.request.get(`${origin}/api/my-learning/overview`);
        assert.equal(response.headers()["cache-control"], "private, no-store");
        const record = (await response.json()).overview.courses.find((record: { courseId: string }) => record.courseId === course.id);
        assert.equal(record.mode, mode);assert.equal(record.progress, 86);
        // Skip the previous presentation URL and restore the cached My Learning entry.
        await page.evaluate(() => history.go(-2));await page.waitForURL(overview);
        await card.getByText(mode === "video" ? messages.overviewV1.video : messages.overviewV1.text, { exact: true }).waitFor();
        assert.equal(new URL((await card.getByRole("link").getAttribute("href"))!, origin).searchParams.get("viewMode"), mode);
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 1000 });await page.screenshot({ path: path.join(output, `${locale}-${mode}-${width}.png`), fullPage: true });
        }
      }
      await context.close();
    }
    console.log("PASS: lesson mode switches immediately update cached My Learning labels and resume URLs in both locales, including paused video.");
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) { const stopped = new Promise<void>(resolve => server!.once("exit", () => resolve()));server.kill();await stopped; }
    process.chdir(repo);process.env = environment;
    if (path.dirname(temporary) === tmpdir() && path.basename(temporary).startsWith("lg-mode-sync-")) await rm(temporary, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error);process.exitCode = 1; });

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { chromium, expect } from "playwright/test";
import { getMessages } from "../lib/i18n/messages";

// Real production pages and Sessions, with disposable DEV accounts and demo purchases.
async function main() {
  const repo = process.cwd(), previous = { ...process.env }, dist = process.env.NEXT_DIST_DIR || ".next-learning-revision-check";
  await readFile(path.join(repo, dist, "BUILD_ID"));
  const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as { port: number }).port, origin = `http://127.0.0.1:${port}`;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const directory = await mkdtemp(path.join(tmpdir(), "lg-preview-assessment-")), output = path.join(repo, "test-results/preview-assessment-production");
  await mkdir(output, { recursive: true });
  Object.assign(process.env, { STORAGE_BACKEND: "local", APP_ENV: "DEV", PAYMENT_MODE: "demo", LOCAL_EMAIL_PREVIEW: "1", LOCAL_SOCIAL_LOGIN: "0", STRIPE_SECRET_KEY: "",
    NEXT_DIST_DIR: dist, NEXT_PUBLIC_APP_URL: origin, SESSION_SECRET: "preview-assessment-disposable-local-secret", KS_TUTOR_BASE_URL: "",
    ADMIN_HOSTS: "admin.example.test" });
  process.chdir(directory);
  let server: ReturnType<typeof spawn> | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const store = await import("../services/productStore");
    const accounts: Array<{ locale: "en-GB" | "zh-CN"; id: string; token: string }> = [];
    for (const locale of ["en-GB", "zh-CN"] as const) {
      const user = await store.registerUser({ email: `preview-${locale}@example.test`, nickname: "Local Learner", password: "Local-learning-only1", locale });
      await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
      accounts.push({ locale, id: user.id, token: (await store.createSession(user.id)).token });
    }
    const courseId = "epicureanism", firstId = "pleasure-and-the-good-life", secondId = "death-is-nothing-to-us";
    const file = path.join(directory, "data/knowledge_system/learning_guide/product.json"), data = JSON.parse(await readFile(file, "utf8"));
    const course = data.courses.find((item: { id: string }) => item.id === courseId);
    for (const lesson of course.sections.flatMap((section: { lessons: Array<{ id: string; contents: unknown[] }> }) => section.lessons)) {
      lesson.contents = [{ id: `${lesson.id}-text`, title: "Reading", type: "text", mode: "lecture", html: "<p>Local course reading for the preview and entitled learning check.</p>", nodes: [] }];
    }
    await writeFile(file, JSON.stringify(data));
    let startupOutput = "", readinessStatus: number | undefined;
    server = spawn(process.execPath, [path.join(repo, "node_modules/next/dist/bin/next"), "start", repo, "-p", String(port), "--hostname", "127.0.0.1"], { cwd: directory, env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout?.on("data", chunk => { startupOutput = (startupOutput + chunk.toString()).slice(-8000); });
    server.stderr?.on("data", chunk => { startupOutput = (startupOutput + chunk.toString()).slice(-8000); });
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { const response = await fetch(`${origin}/en-GB/portal/sign-in`, { signal: AbortSignal.timeout(2000) }); readinessStatus = response.status; if (response.ok) { ready = true; break; } } catch { /* Isolated startup. */ }
      if (server.exitCode !== null) throw new Error(`Isolated Next server stopped. ${startupOutput}`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert(ready, `Isolated Next server did not become ready (last HTTP status ${readinessStatus}). ${startupOutput}`); browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
    for (const account of accounts) {
      const { locale } = account, messages = getMessages(locale);
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await context.addCookies([{ name: "learning_guide_session", value: account.token, url: origin }]);
      const page = await context.newPage(), errors: string[] = [], writes: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => { if (request.method() === "POST" && /\/api\/study\//.test(request.url())) writes.push(request.url()); });
      await page.goto(`${origin}/${locale}/portal/courses/${courseId}/public-lesson?viewMode=text`);
      await page.getByRole("button", { name: messages.legal.rejectOptional, exact: true }).click();
      await page.getByText(/^Local course reading for the/).waitFor();
      await page.waitForLoadState("networkidle"); assert.equal(writes.length, 0);
      const ignored = await context.request.post(`${origin}/api/study/preview`, { data: { courseId, lessonId: firstId, event: "open", clientEventId: "local-preview" } });
      assert.equal(ignored.status(), 200); assert.equal((await ignored.json()).record, null);
      assert.equal((await store.getLearningOverview(account.id)).courses.length, 0);
      const before = await store.ensureProductData(); assert.equal(before.studyEvents.filter(event => event.userId === account.id).length, 0);
      const { quote } = await store.createQuote(account.id, "epicureanism-pc-6"); await store.completeDemoCheckout(account.id, quote.id);
      await page.goto(`${origin}/${locale}/portal/courses/${courseId}`);
      const start = page.locator('[data-syllabus] [data-course-cta-link="continue_learning"]');
      await expect(start).toHaveText(messages.courseDetailDesign.startLearning);
      const fresh = await context.request.get(`${origin}/api/portal/courses/${courseId}`);
      assert.equal((await fresh.json()).page.progress, 0);
      assert.equal((await store.getLearningOverview(account.id)).courses.length, 0);
      await page.screenshot({ path: path.join(output, `${locale}-purchased-zero.png`), fullPage: true });
      await page.goto(`${origin}/${locale}/portal/courses/${courseId}/understanding`);
      const later = page.locator(`[data-lesson-id="${secondId}"] [data-assessment-kind="knowledge"]`);
      await expect(later.getByRole("button", { name: messages.understandingOverview.start, exact: true })).toBeEnabled();
      await expect(page.locator(`[data-lesson-id="${secondId}"] button[aria-expanded]`)).toContainText(messages.understandingOverview.available);
      assert.equal((await store.getLearningOverview(account.id)).courses.length, 0);
      await page.screenshot({ path: path.join(output, `${locale}-all-tests-desktop.png`), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(output, `${locale}-all-tests-mobile.png`), fullPage: true });
      await later.getByRole("button", { name: messages.understandingOverview.start, exact: true }).click();
      const dialog = page.getByRole("dialog"); await dialog.getByRole("textbox").waitFor();
      await dialog.getByRole("textbox").fill("A note for an unstudied lesson.");
      await dialog.getByRole("button", { name: messages.knowledgeTest.close, exact: true }).click(); await expect(dialog).toHaveCount(0);
      const saved = await context.request.get(`${origin}/api/courses/${courseId}/lessons/${secondId}/assessments/knowledge`);
      assert.equal(saved.status(), 200); assert.equal((await saved.json()).data.attempt.responses[0].answer, "A note for an unstudied lesson.");
      assert.equal((await store.getLearningOverview(account.id)).courses.length, 0, "tests do not manufacture Study progress");
      await page.goto(`${origin}/${locale}/account/learn/${courseId}?lessonId=${firstId}&viewMode=text`);
      await expect.poll(async () => (await store.getLearningOverview(account.id)).courses.length).toBe(1);
      assert.deepEqual(errors, []); await context.close();
    }
    console.log("PASS: bilingual real preview makes no Study history; purchase starts at zero with Start learning; unstudied Lesson tests read/save; formal learning alone adds My Learning.");
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) { const stopped = new Promise<void>(resolve => server!.once("exit", () => resolve())); server.kill(); await stopped; }
    process.chdir(repo); process.env = previous;
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith("lg-preview-assessment-")) await rm(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setDefaultResultOrder } from "node:dns";
import { chromium, type Browser, type BrowserContext, type Locator } from "playwright";
import sharp from "sharp";
import type { CourseDraftInput } from "../contracts/course-authoring";
import type { CourseMediaAsset, LessonNode } from "../contracts/lesson-content";
import type { Locale, ProductCourse, ProductData } from "../services/productStore";
import { getMessages } from "../lib/i18n/messages";
import { lessonMessages } from "../messages/lesson-authoring";
import { getCourseManagementMessages } from "../lib/i18n/courseManagementMessages";

// Explicit gate: a BUILD_ID does not establish that concurrent integration work is ready.
// LGTEACHER_BUILD_READY=1 NEXT_DIST_DIR=.next node --import tsx --require ./scripts/register-tsconfig-paths.cjs scripts/test-lgteacher-complete.ts
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.LGTEACHER_TEST_PORT || "3016");
const origin = `http://localhost:${port}`;
const learnerOrigin = `http://127.0.0.1:${port}`;
const sessionCookie = "learning_guide_admin_session";
setDefaultResultOrder("ipv4first");
const dist = process.env.NEXT_DIST_DIR || process.env.NEXTDIST || ".next";
const results: Array<{ name: string; status: "passed" | "failed"; detail?: string }> = [];
let captureFailure: ((name: string) => Promise<void>) | undefined;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const draftOf = (course: ProductCourse): CourseDraftInput => ({ expectedUpdatedAt: course.updatedAt, title: course.title, description: course.description, sections: structuredClone(course.sections) });

async function check(name: string, work: () => Promise<void>) {
  try { await work(); results.push({ name, status: "passed" }); console.log(`PASS ${name}`); }
  catch (error) { const detail = error instanceof Error ? error.stack || error.message : String(error); results.push({ name, status: "failed", detail }); console.error(`FAIL ${name}\n${detail}`); await captureFailure?.(name).catch(captureError => console.error("Failure capture:", captureError)); }
}

async function stop(server: ChildProcess | undefined) {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise<void>(resolve => server.once("exit", () => resolve()));
  server.kill("SIGTERM");
  if (!await Promise.race([exited.then(() => true), delay(5000).then(() => false)])) {
    server.kill("SIGKILL");
    assert(await Promise.race([exited.then(() => true), delay(5000).then(() => false)]), "Preview process did not stop");
  }
}

async function assertFreePort() {
  assert(Number.isInteger(port) && port > 1024 && port < 65536 && port !== 3014, "Use a dedicated unprivileged port, never parent port 3014");
  const socket = createServer();
  await new Promise<void>((resolve, reject) => { socket.once("error", reject); socket.listen(port, "127.0.0.1", () => resolve()); });
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
}

async function localFixtures(browser: Browser, directory: string) {
  const page = await browser.newPage();
  try {
    // Record an actual moving canvas into a tiny playable WebM, without remote fixture downloads.
    const result = await page.evaluate(async () => {
      const canvas = document.createElement("canvas"); canvas.width = 160; canvas.height = 90;
      const context = canvas.getContext("2d")!;
      const mimeType = ["video/webm;codecs=vp8", "video/webm"].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("Chromium cannot generate a local WebM fixture");
      const stream = canvas.captureStream(12), recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
      recorder.start();
      for (let frame = 0; frame < 36; frame++) {
        context.fillStyle = "#247b5e"; context.fillRect(0, 0, 160, 90);
        context.fillStyle = "#f0cc42"; context.fillRect((frame * 4) % 130, 25, 30, 30);
        await new Promise(resolve => setTimeout(resolve, 85));
      }
      recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
      const bytes = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
      return { png: canvas.toDataURL("image/png").split(",")[1], webm: Array.from(bytes) };
    });
    const image = path.join(directory, "fixture.png"), video = path.join(directory, "fixture.webm"), model = path.join(directory, "fixture.obj"), pdf = path.join(directory, "fixture.pdf");
    await writeFile(image, Buffer.from(result.png, "base64"));
    await writeFile(video, Buffer.from(result.webm));
    await writeFile(model, "v -1 -1 -1\nv 1 -1 -1\nv 0 1 -1\nv 0 0 1\nf 1 2 3\nf 1 4 2\nf 2 4 3\nf 3 4 1\n");
    const content = "BT /F1 18 Tf 30 90 Td (Local LGTeacher PDF fixture) Tj ET\n";
    const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 160] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`];
    let pdfDocument = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdfDocument)); pdfDocument += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = Buffer.byteLength(pdfDocument);
    pdfDocument += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    await writeFile(pdf, pdfDocument);
    assert(result.webm.length > 100 && result.webm.length < 1024 * 1024, "Fixture must remain a small real video");
    return { image, video, model, pdf };
  } finally { await page.close(); }
}

async function main() {
  assert.equal(process.env.LGTEACHER_BUILD_READY, "1", "Parent must confirm build readiness before setting LGTEACHER_BUILD_READY=1");
  const buildId = (await readFile(path.resolve(repo, dist, "BUILD_ID"), "utf8")).trim();
  assert(buildId, "Production build ID must not be empty");
  await assertFreePort();
  const previousCwd = process.cwd();
  const temporary = await mkdtemp(path.join(tmpdir(), "lgteacher-complete-store-"));
  const artefacts = process.env.LGTEACHER_TEST_ARTEFACTS ? path.resolve(process.env.LGTEACHER_TEST_ARTEFACTS) : await mkdtemp(path.join(tmpdir(), "lgteacher-complete-report-"));
  await mkdir(artefacts, { recursive: true });
  const log = createWriteStream(path.join(artefacts, "server.log"));
  let server: ChildProcess | undefined, browser: Browser | undefined;
  let serverError: Error | undefined;
  try {
    process.chdir(temporary);
    Object.assign(process.env, { STORAGE_BACKEND: "local", APP_ENV: "test", LOCAL_EMAIL_PREVIEW: "1", ADMIN_HOSTS: "localhost", PAYMENT_MODE: "demo", NEXT_DIST_DIR: dist, NEXT_PUBLIC_APP_URL: learnerOrigin, BACKOFFICE_OPERATOR_EMAIL: "operator@lgteacher-browser.test", LOCAL_SOCIAL_LOGIN: "0" });
    const store = await import("../services/productStore");
    const files = await import("../services/fileStore");
    const tokens: Record<string, string> = {}, userIds: Record<string, string> = {};
    for (const name of ["operator", "teacher", "foreign", "student", "disabled", "pending"]) {
      const user = await store.registerUser({ email: `${name}@lgteacher-browser.test`, password: "browser-regression1" });
      userIds[name] = user.id;
      if (name !== "pending") await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
      tokens[name] = (await store.createSession(user.id)).token;
    }
    const productFile = path.join(temporary, "data/knowledge_system/learning_guide/product.json");
    const initial = await store.ensureProductData();
    for (const name of ["teacher", "foreign", "disabled", "pending"]) initial.users.find(user => user.id === userIds[name])!.role = "teacher";
    initial.users.find(user => user.id === userIds.disabled)!.status = "disabled";
    await files.atomicWriteJson(productFile, initial);
    let course = await store.createCourseForOperator({ title: "LGTeacher complete browser regression" }, userIds.teacher);
    const lesson = await store.addLessonToCourse({ courseId: course.id, title: "Persisted lesson", body: "Initial legacy text", durationMinutes: 5, isPublic: true }, userIds.teacher);
    course = await store.getCourseForAuthor(userIds.teacher, course.id);
    const foreignCourse = await store.createCourseForOperator({ title: "Foreign teacher course" }, userIds.foreign);
    const seed = await store.ensureProductData(), timestamp = new Date().toISOString();
    seed.studyRecords.push({ id: "history-record", userId: userIds.student, courseId: course.id, currentLessonId: lesson.id, startedAt: timestamp, updatedAt: timestamp, totalSeconds: 20, progress: 7, completedAt: null });
    seed.studyEvents.push({ id: "history-event", userId: userIds.student, courseId: course.id, lessonId: lesson.id, event: "text_progress", seconds: 20, clientEventId: "history-client-id", createdAt: timestamp });
    seed.plans.push({ id: "lgteacher-history-plan", courseId: course.id, name: "Historical regression plan", scope: "course", scopeId: course.id, device: "pc", termMonths: 6, amountMinor: 1000, currency: "usd" });
    await files.atomicWriteJson(productFile, seed);
    const { quote } = await store.createQuote(userIds.student, "lgteacher-history-plan");
    const historicalOrder = await store.createPendingDemoOrder(userIds.student, quote.id);
    await store.completeDemoOrder(userIds.student, historicalOrder.order.id);
    browser = await chromium.launch();
    const fixtures = await localFixtures(browser, temporary);
    server = spawn(process.execPath, [path.join(repo, "node_modules/next/dist/bin/next"), "start", repo, "-p", String(port), "--hostname", "127.0.0.1"], { cwd: temporary, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
    server.on("error", error => { serverError = error; });
    server.stdout!.pipe(log, { end: false }); server.stderr!.pipe(log, { end: false });
    for (let attempt = 0; ; attempt++) {
      if (serverError) throw serverError;
      assert(server.exitCode === null && server.signalCode === null, "Preview server exited; inspect server.log");
      assert(attempt < 150, "Preview server did not become ready within 60 seconds");
      try { if ((await fetch(`${origin}/en-GB/backoffice/sign-in`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch { /* bounded startup retry */ }
      await delay(400);
    }
    const contexts = new Map<string, BrowserContext>();
    async function context(name: string) {
      if (!contexts.has(name)) {
        const created = await browser!.newContext({ viewport: { width: 1440, height: 1000 } });
        if (tokens[name]) await created.addCookies([{ name: sessionCookie, value: tokens[name], url: origin }]);
        if (name === "learner-cookie") await created.addCookies([{ name: "learning_guide_session", value: tokens.teacher, url: origin }]);
        contexts.set(name, created);
      }
      return contexts.get(name)!;
    }
    async function api(name: string, endpoint: string, method = "GET", body?: unknown, requestOrigin: string | null = origin) {
      return (await context(name)).request.fetch(`${origin}${endpoint}`, { method, headers: { ...(requestOrigin === null ? {} : { Origin: requestOrigin }), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { data: body }), timeout: 15000 });
    }
    const endpoint = `/api/backoffice/courses/${course.id}`;
    async function reloadCourse() {
      const response = await api("teacher", endpoint);
      assert.equal(response.status(), 200, await response.text());
      course = (await response.json()).course as ProductCourse;
      return course;
    }
    // Before mutations, prove this server sees the temporary store and its unique account/course.
    await reloadCourse();
    assert.equal(course.sections[0].lessons[0].id, lesson.id, "Server is not using the isolated seeded store");

    await check("HTTP ownership, inactive sessions, CSRF and paginated isolation", async () => {
      for (const name of ["anonymous", "student", "pending", "disabled"]) {
        assert.equal((await api(name, endpoint)).status(), 403, name);
        assert.equal((await api(name, `${endpoint}/draft`, "PUT", draftOf(course))).status(), 403, name);
      }
      assert.equal((await api("foreign", endpoint)).status(), 404);
      assert.equal((await api("teacher", `/api/backoffice/courses/${foreignCourse.id}`)).status(), 404);
      const listed = await api("teacher", "/api/backoffice/courses?status=all&pageSize=100");
      assert.equal(listed.status(), 200);
      assert.deepEqual((await listed.json()).courses.map((item: ProductCourse) => item.id), [course.id]);
      for (const invalidOrigin of [null, "https://other.test", `${origin}/path`]) assert.equal((await api("teacher", `${endpoint}/draft`, "PUT", draftOf(course), invalidOrigin)).status(), 403);
      assert.equal((await api("teacher", "/api/backoffice/orders")).status(), 403, "Teachers must not inherit financial access");
      assert.equal((await api("learner-cookie", endpoint)).status(), 403, "Learner cookie must not author on the admin host");
      const learnerHost = await (await context("teacher")).request.get(`${learnerOrigin}${endpoint}`, { headers: { Cookie: `${sessionCookie}=${tokens.teacher}` }, maxRedirects: 0 });
      assert.equal(learnerHost.status(), 404, "Admin cookies must not expose authoring on the learner host");
      const learnerMutation = await (await context("teacher")).request.put(`${learnerOrigin}${endpoint}/draft`, { headers: { Origin: learnerOrigin, Cookie: `${sessionCookie}=${tokens.teacher}` }, data: draftOf(course), maxRedirects: 0 });
      assert.equal(learnerMutation.status(), 404, "Learner-host authoring writes must remain unavailable");
    });

    const page = await (await context("teacher")).newPage();
    captureFailure = async name => {
      const file = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 90);
      await page.screenshot({ path: path.join(artefacts, `failure-${file}.png`), fullPage: true, timeout: 5000 });
      await writeFile(path.join(artefacts, `failure-${file}.html`), await page.content());
    };
    const pageErrors: string[] = [], failedRequests: string[] = [], consoleErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("requestfailed", request => { if (request.url().startsWith(origin) && !request.failure()?.errorText.includes("ERR_ABORTED")) failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`); });
    await page.addInitScript(() => { (window as unknown as { __lgteacherXss: number }).__lgteacherXss = 0; });
    page.on("dialog", dialog => { void dialog.accept(); });
    async function editor(locale: Locale, convertLegacy = false) {
      await page.goto(`${origin}/${locale}/backoffice/courses`, { waitUntil: "networkidle" });
      const copy = getMessages(locale).authoring;
      const cookie = page.getByRole("button", { name: getMessages(locale).legal.rejectOptional, exact: true });
      if (await cookie.count() && await cookie.isVisible()) await cookie.click();
      const row = page.locator(".backoffice-course-row").filter({ hasText: course.title });
      await row.getByRole("button", { name: copy.heading, exact: true }).click();
      const outline = page.locator(".authoring-editor");
      const detail = outline.locator(".authoring-lesson").filter({ hasText: "Persisted lesson" });
      if (await detail.count() && await detail.getAttribute("open") === null) await detail.locator(":scope > summary").click();
      if (convertLegacy) await detail.getByRole("button", { name: getCourseManagementMessages(locale).convert, exact: true }).click();
      return { outline, content: outline.locator(".la-editor").first(), copy, t: lessonMessages(locale) };
    }
    async function screenshot(name: string) {
      await page.screenshot({ path: path.join(artefacts, `${name}.png`), fullPage: true });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: horizontal overflow`);
    }
    async function upload(container: Locator, filePath: string) {
      const [response] = await Promise.all([page.waitForResponse(response => response.url().endsWith(`${endpoint}/media`) && response.request().method() === "POST"), container.locator('input[type="file"]').setInputFiles(filePath)]);
      assert.equal(response.status(), 201, await response.text());
      return (await response.json()).data as CourseMediaAsset;
    }
    async function selectGroup(player: Locator, title: string) {
      await player.locator(".la-content-nav button").filter({ hasText: title }).click();
      await player.getByRole("heading", { name: title, exact: true }).waitFor();
    }
    let imageAsset: CourseMediaAsset | undefined, videoAsset: CourseMediaAsset | undefined, modelAsset: CourseMediaAsset | undefined, pdfAsset: CourseMediaAsset | undefined;
    let structuredSaved = false;
    await check("Browser authors structured text, inline quiz, image/video nodes and a real timed video", async () => {
      const { outline, content, copy, t } = await editor("en-GB", true);
      await content.getByRole("button", { name: t.addContent, exact: true }).click();
      const textGroup = content.locator(".la-content-group").last();
      await textGroup.getByLabel(t.title, { exact: true }).first().fill("Structured browser text");
      const rich = textGroup.locator('[contenteditable="true"]').first();
      await rich.fill("Browser persisted rich text");
      await rich.press("ControlOrMeta+a");
      await textGroup.getByRole("button", { name: t.bold, exact: true }).first().click();
      await rich.press("ArrowRight");
      await rich.press("End"); await rich.press("Enter");
      await textGroup.getByRole("button", { name: t.taskList, exact: true }).first().click();
      await rich.pressSequentially("Persisted task-list item");
      await rich.locator('li input[type="checkbox"]').check();
      await rich.press("End"); await rich.press("Enter"); await rich.press("Enter");
      async function node(group: Locator, title: string, type: LessonNode["type"]) {
        await group.getByRole("button", { name: t.addNode, exact: true }).click();
        const item = group.locator(".la-node-editor").last();
        await item.locator("summary").click();
        await item.getByLabel(t.title, { exact: true }).fill(title);
        await item.getByLabel(t.type).selectOption(type);
        return item;
      }
      const note = await node(textGroup, "Browser text node", "text");
      await note.locator('[contenteditable="true"]').fill("Persisted node explanation");
      const image = await node(textGroup, "Browser image node", "image");
      imageAsset = await upload(image, fixtures.image);
      const video = await node(textGroup, "Browser video node", "video");
      videoAsset = await upload(video, fixtures.video);
      const quiz = await node(textGroup, "Browser quiz node", "exercise");
      await quiz.getByLabel(t.question, { exact: true }).fill("Which option is correct?");
      await quiz.getByLabel(t.answerType).selectOption("choice");
      await quiz.getByLabel(`${t.options} 1`, { exact: true }).fill("First option");
      await quiz.getByLabel(`${t.options} 2`, { exact: true }).fill("Second option");
      await quiz.getByLabel(`${t.correctOption} 2`, { exact: true }).check();
      const model = await node(textGroup, "Browser OBJ node", "model3d");
      modelAsset = await upload(model, fixtures.model);
      await rich.click(); await rich.press("ControlOrMeta+End");
      await textGroup.getByLabel(t.insertInstance, { exact: true }).first().selectOption({ label: "Browser quiz node" });
      await content.locator(":scope > .la-actions > select").selectOption("video");
      await content.getByRole("button", { name: t.addContent, exact: true }).click();
      const timed = content.locator(".la-content-group").last();
      await timed.getByLabel(t.title, { exact: true }).first().fill("Timed browser video");
      await timed.getByLabel(t.mode).selectOption("interactive");
      await timed.getByLabel(t.url, { exact: true }).fill(videoAsset.url);
      const pause = await node(timed, "Timed question", "exercise");
      await pause.getByLabel(t.triggerTime, { exact: true }).fill("0.5");
      await pause.getByLabel(t.question, { exact: true }).fill("Two plus two?");
      await pause.getByLabel(t.answer, { exact: true }).fill("4");
      const inactivePause = await node(timed, "Disabled pause must not run", "exercise");
      await inactivePause.getByLabel(t.triggerTime, { exact: true }).fill("0.1");
      await inactivePause.getByLabel(t.question, { exact: true }).fill("Inactive question");
      await inactivePause.getByLabel(t.answer, { exact: true }).fill("Not shown");
      await inactivePause.getByLabel(t.active, { exact: true }).uncheck();
      await content.locator(":scope > .la-actions > select").selectOption("pdf");
      await content.getByRole("button", { name: t.addContent, exact: true }).click();
      const pdf = content.locator(".la-content-group").last();
      await pdf.getByLabel(t.title, { exact: true }).first().fill("Persisted PDF");
      pdfAsset = await upload(pdf, fixtures.pdf);
      await content.locator(":scope > .la-actions > select").selectOption("text");
      await content.getByRole("button", { name: t.addContent, exact: true }).click();
      const inactive = content.locator(".la-content-group").last();
      await inactive.getByLabel(t.title, { exact: true }).first().fill("Inactive group must not render");
      await inactive.locator('[contenteditable="true"]').fill("Inactive persisted content");
      await inactive.getByLabel(t.active, { exact: true }).uncheck();
      await screenshot("editor-desktop");
      await page.setViewportSize({ width: 390, height: 844 }); await screenshot("editor-mobile");
      const [response] = await Promise.all([page.waitForResponse(response => response.url().endsWith(`${endpoint}/draft`) && response.request().method() === "PUT"), outline.getByRole("button", { name: copy.save, exact: true }).click()]);
      assert.equal(response.status(), 200, await response.text());
      await outline.waitFor({ state: "detached" });
      await reloadCourse();
      const saved = course.sections[0].lessons[0].contents!;
      const text = saved.find(item => item.title === "Structured browser text")!;
      assert(text, "Structured text was not saved");
      assert.match(text.html!, /<strong>Browser persisted rich text<\/strong>/);
      assert.match(text.html!, /data-node-id=/);
      assert.match(text.html!, /data-type="taskList"/);
      assert.match(text.html!, /data-checked="true"/);
      assert.deepEqual(text.nodes.map(item => item.type), ["text", "image", "video", "exercise", "model3d"]);
      assert.equal(text.nodes[1].url, imageAsset.url);
      assert.deepEqual(text.nodes[3].correctOptions, [1]);
      assert.equal(saved.find(item => item.title === "Timed browser video")!.nodes[0].triggerTime, 0.5);
      assert.equal(saved.find(item => item.title === "Timed browser video")!.nodes[1].active, false);
      assert.equal(saved.find(item => item.title === "Inactive group must not render")!.active, false);
      structuredSaved = true;
    });

    await check("HTTP real media bytes, seeking, MIME checks and private media access", async () => {
      assert(imageAsset && videoAsset && modelAsset && pdfAsset, "UI uploads did not complete");
      const image = await api("teacher", imageAsset.url);
      assert.equal(image.status(), 200); assert.deepEqual(await image.body(), await readFile(fixtures.image));
      assert.equal(image.headers()["x-content-type-options"], "nosniff");
      assert.match(image.headers()["cache-control"], /private/);
      const range = await (await context("teacher")).request.get(`${origin}${videoAsset.url}`, { headers: { Range: "bytes=0-15" } });
      assert.equal(range.status(), 206); assert.equal((await range.body()).length, 16);
      assert.match(range.headers()["content-range"], /^bytes 0-15\//);
      for (const [asset, file] of [[modelAsset, fixtures.model], [pdfAsset, fixtures.pdf]] as const) {
        const response = await api("teacher", asset.url);
        assert.equal(response.status(), 200); assert.deepEqual(await response.body(), await readFile(file));
        assert.equal(response.headers()["content-type"], asset.mimeType);
      }
      for (const name of ["anonymous", "foreign", "student", "disabled"]) assert.equal((await api(name, imageAsset.url)).status(), 404, name);
      const fake = await (await context("teacher")).request.post(`${origin}${endpoint}/media`, { headers: { Origin: origin }, multipart: { file: { name: "fake.png", mimeType: "image/png", buffer: Buffer.from("<script>window.__lgteacherXss=1</script>") } } });
      assert.equal(fake.status(), 415, await fake.text());
    });

    await check("Browser reload/preview runs inline instances, quizzes, images and timed pause/resume", async () => {
      assert(structuredSaved, "Blocked by unsuccessful structured authoring/save");
      await page.setViewportSize({ width: 1440, height: 1000 });
      const { content, t } = await editor("en-GB");
      const textGroup = content.locator(".la-content-group").filter({ has: page.locator('input[value="Structured browser text"]') });
      assert.match(await textGroup.locator('[contenteditable="true"]').first().innerHTML(), /<strong>Browser persisted rich text<\/strong>/);
      assert.equal(await textGroup.locator('li[data-checked="true"]').count(), 1);
      await content.getByRole("button", { name: t.preview, exact: true }).click();
      const player = content.locator(".la-player");
      await selectGroup(player, "Structured browser text");
      assert.equal(await player.locator(".la-content-nav button").filter({ hasText: "Inactive group must not render" }).count(), 0);
      await player.locator('li[data-type="taskItem"][data-checked="true"]').waitFor();
      assert.equal(await player.locator('li[data-type="taskItem"][data-checked="true"]').count(), 1);
      await player.locator("[data-node-id]").filter({ hasText: "Browser quiz node" }).click();
      let modal = page.getByRole("dialog");
      await modal.getByLabel("Second option", { exact: true }).check();
      await modal.getByRole("button", { name: t.reveal, exact: true }).click();
      assert.match(await modal.locator(".la-answer").innerText(), /Correct/);
      await modal.getByRole("button", { name: t.resume, exact: true }).click();
      await player.getByRole("button", { name: "Browser image node", exact: true }).click();
      modal = page.getByRole("dialog");
      await modal.locator("img").waitFor();
      await page.waitForFunction(() => { const image = document.querySelector('dialog img') as HTMLImageElement | null; return !!image && image.complete && image.naturalWidth > 0; });
      await modal.getByRole("button", { name: t.resume, exact: true }).click();
      await selectGroup(player, "Timed browser video");
      assert.equal(await player.getByRole("button", { name: "Disabled pause must not run", exact: true }).count(), 0);
      const video = player.locator("video.la-lesson-video");
      await video.evaluate(async (element: HTMLVideoElement) => { await element.play(); });
      modal = page.getByRole("dialog");
      await modal.getByText("Two plus two?", { exact: true }).waitFor({ timeout: 10000 });
      assert.equal(await video.evaluate((element: HTMLVideoElement) => element.paused), true);
      await modal.getByLabel(t.yourAnswer, { exact: true }).fill("4");
      await modal.getByRole("button", { name: t.reveal, exact: true }).click();
      assert.match(await modal.locator(".la-answer").innerText(), /4/);
      await modal.getByRole("button", { name: t.resume, exact: true }).click();
      await page.waitForFunction(() => { const video = document.querySelector('video.la-lesson-video') as HTMLVideoElement | null; return !!video && video.currentTime > 0.8; });
      await screenshot("preview-desktop");
      await page.setViewportSize({ width: 390, height: 844 }); await screenshot("preview-mobile");
    });

    await check("PDF preview displays nonblank content on desktop and mobile", async () => {
      assert(structuredSaved && pdfAsset, "Blocked by unsuccessful structured authoring/save");
      const { content, t } = await editor("en-GB");
      await content.getByRole("button", { name: t.preview, exact: true }).click();
      const player = content.locator(".la-player");
      await selectGroup(player, "Persisted PDF");
      const frame = player.locator('iframe[title="Persisted PDF"]');
      assert.equal(await frame.getAttribute("src"), pdfAsset.url);
      assert.equal(await player.getByRole("link", { name: t.openPdf, exact: true }).getAttribute("href"), pdfAsset.url);
      for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 390, height: 844 }]] as const) {
        await page.setViewportSize(viewport);
        let visiblePixels = false;
        let screenshot: Buffer = Buffer.alloc(0);
        for (let attempt = 0; attempt < 20; attempt++) {
          screenshot = await frame.screenshot();
          const { data, info } = await sharp(screenshot).resize(256, 192, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
          let darkest = 255, lightest = 0;
          const colours = new Set<string>();
          // Ignore iframe borders: a blank frame must not pass on its outline alone.
          for (let y = 5; y < info.height - 5; y++) for (let x = 5; x < info.width - 5; x++) {
            const index = (y * info.width + x) * info.channels;
            const shade = Math.round((data[index] + data[index + 1] + data[index + 2]) / 3);
            darkest = Math.min(darkest, shade); lightest = Math.max(lightest, shade);
            colours.add(`${data[index] >> 3},${data[index + 1] >> 3},${data[index + 2] >> 3}`);
          }
          visiblePixels = lightest - darkest > 32 && colours.size > 8;
          if (visiblePixels) break;
          await delay(250);
        }
        await writeFile(path.join(artefacts, `pdf-${name}.png`), screenshot);
        assert(visiblePixels, `${name}: PDF bytes/iframe loaded, but the preview remains blank after waiting for rendering`);
      }
    });

    await check("OBJ canvas renders nonblank, rotates and responds to dragging on desktop/mobile", async () => {
      assert(structuredSaved && modelAsset, "Blocked by unsuccessful structured authoring/save");
      const { content, t } = await editor("en-GB");
      await content.getByRole("button", { name: t.preview, exact: true }).click();
      await selectGroup(content.locator(".la-player"), "Structured browser text");
      await content.getByRole("button", { name: "Browser OBJ node", exact: true }).click();
      const modal = page.getByRole("dialog"), canvas = modal.locator("canvas");
      await canvas.waitFor();
      const reset = modal.getByRole("button", { name: t.resetView, exact: true });
      await page.waitForFunction(() => { const button = document.querySelector('dialog .la-model-tools button') as HTMLButtonElement | null; return !!button && !button.disabled; });
      async function sample() {
        return canvas.evaluate((element: HTMLCanvasElement) => new Promise<{ colours: number; coloured: number; signature: string }>(resolve => requestAnimationFrame(() => {
          const copy = document.createElement("canvas"); copy.width = 64; copy.height = 64;
          const context = copy.getContext("2d")!; context.drawImage(element, 0, 0, 64, 64);
          const pixels = context.getImageData(0, 0, 64, 64).data, colours = new Set<string>(); let coloured = 0;
          const signature: number[] = [];
          for (let index = 0; index < pixels.length; index += 4) {
            const [r, g, b] = pixels.slice(index, index + 3); colours.add(`${r >> 3},${g >> 3},${b >> 3}`);
            if (g - r > 15 || b - r > 15) coloured++;
            if (index % 64 === 0) signature.push(r, g, b);
          }
          resolve({ colours: colours.size, coloured, signature: signature.join(",") });
        })));
      }
      for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 390, height: 844 }]] as const) {
        await page.setViewportSize(viewport); await reset.click(); await delay(250);
        let initial = await sample();
        for (let attempt = 0; attempt < 20 && initial.coloured < 20; attempt++) { await delay(100); initial = await sample(); }
        assert(initial.colours > 3 && initial.coloured > 20 && initial.coloured < 3500, `${name}: OBJ must be visible and framed: ${JSON.stringify(initial).slice(0, 160)}`);
        await canvas.screenshot({ path: path.join(artefacts, `obj-${name}.png`) });
        const bounds = await canvas.boundingBox(); assert(bounds && bounds.width > 100 && bounds.height > 100);
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
        await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.55, { steps: 12 }); await page.mouse.up();
        await delay(300); assert.notEqual((await sample()).signature, initial.signature, `${name}: drag must orbit the model`);
        await modal.getByRole("button", { name: t.rotate, exact: true }).click();
        const rotating = await sample(); await delay(500);
        assert.notEqual((await sample()).signature, rotating.signature, `${name}: auto-rotation must advance`);
        await modal.getByRole("button", { name: t.rotate, exact: true }).click();
        await screenshot(`obj-modal-${name}`);
      }
      await modal.getByRole("button", { name: t.resume, exact: true }).click();
    });

    await check("HTTP stale saves, persisted XSS and cross-course media are rejected/sanitised", async () => {
      assert(structuredSaved, "Blocked by unsuccessful structured authoring/save");
      await reloadCourse();
      const base = draftOf(course);
      const dirty = structuredClone(base);
      const text = dirty.sections[0].lessons[0].contents!.find(item => item.type === "text")!;
      text.html = `${text.html || ""}<img src=x onerror="window.__lgteacherXss=1"><script>window.__lgteacherXss=1</script><a href="javascript:alert(1)">Unsafe link</a>`;
      const saved = await api("teacher", `${endpoint}/draft`, "PUT", dirty);
      assert.equal(saved.status(), 200, await saved.text());
      assert.equal((await api("teacher", `${endpoint}/draft`, "PUT", base)).status(), 409);
      await reloadCourse();
      assert.doesNotMatch(JSON.stringify(course.sections[0].lessons[0].contents), /onerror|<script|javascript:/i);
      const foreign = draftOf(course);
      foreign.sections[0].lessons[0].contents!.push({ id: "foreign-video", title: "Foreign", type: "video", mode: "lecture", url: `/api/course-media/${foreignCourse.id}/11111111-1111-4111-8111-111111111111`, nodes: [] });
      assert.equal((await api("teacher", `${endpoint}/draft`, "PUT", foreign)).status(), 400);
      const { content, t } = await editor("en-GB");
      await content.getByRole("button", { name: t.preview, exact: true }).click();
      assert.equal(await page.evaluate(() => (window as unknown as { __lgteacherXss: number }).__lgteacherXss), 0);
      assert.equal(await content.locator("script,iframe[srcdoc],[onerror],[onclick]").count(), 0);
    });

    await check("Chinese saved-content preview and mobile layout", async () => {
      assert(structuredSaved, "Blocked by unsuccessful structured authoring/save");
      for (const locale of ["en-GB", "zh-CN"] as const) {
        await page.goto(`${origin}/${locale}/backoffice/courses`, { waitUntil: "networkidle" });
        const row = page.locator(".backoffice-course-row").filter({ hasText: course.title });
        await row.getByRole("button", { name: `${getCourseManagementMessages(locale).preview}: ${course.title}`, exact: true }).click();
        const preview = page.locator(".course-draft-preview");
        await selectGroup(preview.locator(".la-player"), "Persisted PDF");
        await selectGroup(preview.locator(".la-player"), "Structured browser text");
        await preview.locator('li[data-type="taskItem"][data-checked="true"]').waitFor();
        assert.equal(await preview.locator('li[data-type="taskItem"][data-checked="true"]').count(), 1);
        await page.setViewportSize({ width: 390, height: 844 }); await screenshot(`saved-preview-${locale}-mobile`);
        await page.setViewportSize({ width: 1440, height: 1000 }); await screenshot(`saved-preview-${locale}-desktop`);
      }
    });

    await check("Actual DELETE archives a referenced course without deleting learner history", async () => {
      await reloadCourse();
      const before: ProductData = JSON.parse(await readFile(productFile, "utf8"));
      assert(before.orders.some(order => order.id === historicalOrder.order.id && order.status === "paid"), "Actual historical order missing");
      assert(before.entitlements.some(item => item.userId === userIds.student), "Actual historical entitlement missing");
      const response = await api("teacher", endpoint, "DELETE", { expectedUpdatedAt: course.updatedAt });
      assert.equal(response.status(), 200, await response.text());
      const after: ProductData = JSON.parse(await readFile(productFile, "utf8"));
      const retained = after.courses.find(item => item.id === course.id)!;
      assert.equal(retained.status, "archived");
      assert.deepEqual(retained.sections, course.sections);
      for (const key of ["studyRecords", "studyEvents", "orders", "subscriptions", "entitlements", "conversations"] as const) assert.deepEqual(after[key], before[key], key);
      assert.equal((await api("teacher", `${endpoint}/draft`, "PUT", draftOf(retained))).status(), 400);
    });
    await check("Browser has no uncaught errors or failed same-origin requests", async () => {
      assert.deepEqual(pageErrors, []); assert.deepEqual(failedRequests, []); assert.deepEqual(consoleErrors, []);
    });
    for (const item of contexts.values()) await item.close();
  } catch (error) {
    results.push({ name: "Runner setup or execution", status: "failed", detail: error instanceof Error ? error.stack : String(error) });
    console.error(error);
  } finally {
    await browser?.close().catch(error => { results.push({ name: "Browser shutdown", status: "failed", detail: String(error) }); });
    await stop(server).catch(error => { results.push({ name: "Server shutdown", status: "failed", detail: String(error) }); });
    await new Promise<void>(resolve => log.end(resolve));
    process.chdir(previousCwd);
    await rm(temporary, { recursive: true, force: true });
    await writeFile(path.join(artefacts, "results.json"), JSON.stringify({ origin, learnerOrigin, adminHosts: "localhost", sessionCookie, dist, buildId, results, limitations: ["Local synthetic fixtures; no external provider or production deployment verification.", "No source data migration or complete Figma parity assertion."] }, null, 2));
    console.log(`Report: ${path.join(artefacts, "results.json")}`);
    console.log(`${results.filter(item => item.status === "passed").length} passed; ${results.filter(item => item.status === "failed").length} failed`);
    if (results.some(item => item.status === "failed")) process.exitCode = 1;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

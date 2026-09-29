import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { getMessages } from "../lib/i18n/messages";

// Disposable local accounts/data only. Requires a completed .next-ui-check build.
async function main() {
const repo = process.cwd(), port = 3037, origin = `http://127.0.0.1:${port}`;
const probe = createServer();
await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen(port, "127.0.0.1", resolve); });
await new Promise<void>(resolve => probe.close(() => resolve()));
await readFile(path.join(repo, ".next-ui-check/BUILD_ID"), "utf8");
const temporary = await mkdtemp(path.join(tmpdir(), "lg-video-preview-"));
const output = path.join(repo, "test-results/preview-video");
await mkdir(output, { recursive: true });
Object.assign(process.env, { STORAGE_BACKEND: "local", APP_ENV: "test", PAYMENT_MODE: "demo", LOCAL_EMAIL_PREVIEW: "1", LOCAL_SOCIAL_LOGIN: "0", NEXT_DIST_DIR: ".next-ui-check", NEXT_PUBLIC_APP_URL: origin, SESSION_SECRET: "preview-test-only-local-secret" });
process.chdir(temporary);
const store = await import("../services/productStore");
const files = await import("../services/fileStore");
const user = await store.registerUser({ email: "preview-visual@example.test", password: "Preview-local-test1" });
await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
const session = await store.createSession(user.id);
const data = await store.ensureProductData();
const course = data.courses[0];
course.status = "published"; course.title = "The Art of Seeing"; course.category = "Science";
course.description = "Learn to observe a work of art with attention, curiosity and confidence.";
course.cover = "/portal/course-study.jpg";
course.sections = [{ id: "preview-section", title: "Observation", lessons: [
  { id: "preview-video", title: "Looking closely", body: "A public lesson.", durationMinutes: 20, isPublic: true, contents: [
    { id: "video", type: "video", mode: "interactive", title: "Observe composition", url: `/api/course-media/${course.id}/11111111-1111-4111-8111-111111111111`, nodes: [
      { id: "exercise", title: "Reflection", type: "exercise", triggerTime: 120, question: "What do you notice?", answer: "Details" },
      { id: "exhibit", title: "Visual cues", type: "text", triggerTime: 130, html: "<p>Look for shapes and colours.</p>" },
    ] },
    { id: "text", type: "text", mode: "lecture", title: "Read visual cues", html: "<p>Observe the composition.</p><p>Read the image.</p>", nodes: [] },
  ] },
  { id: "second-preview", title: "Reading images", body: "Second public lesson.", durationMinutes: 2, isPublic: true },
  { id: "private-lesson", title: "Objects and memory", body: "PRIVATE_BODY_SENTINEL", durationMinutes: 10, isPublic: false },
] }];
const productFile = path.join(temporary, "data/knowledge_system/learning_guide/product.json");
await files.atomicWriteJson(productFile, data);
const server = spawn(process.execPath, [path.join(repo, "node_modules/next/dist/bin/next"), "start", repo, "-p", String(port), "--hostname", "127.0.0.1"], { cwd: temporary, env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let logs = "";
server.stdout.on("data", chunk => { logs += chunk; }); server.stderr.on("data", chunk => { logs += chunk; });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${origin}/en-GB/portal/sign-in`, { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch {}
    if (server.exitCode !== null) throw new Error(logs);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready, logs);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/en-GB/portal/sign-in`);
  // A real, locally generated video verifies playback without downloading media.
  const media = await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 180;
    document.body.appendChild(canvas);
    const drawing = canvas.getContext("2d")!;
    drawing.fillStyle = "#15233a"; drawing.fillRect(0, 0, 320, 180);
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" }), chunks: Blob[] = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
    recorder.start();
    for (let i = 0; i < 30; i++) { drawing.fillStyle = i % 2 ? "#15233a" : "#246bfd"; drawing.fillRect(0, 0, 320, 180); track.requestFrame(); await new Promise(resolve => setTimeout(resolve, 100)); }
    recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  assert(media.length > 1000, "Recorded fixture must contain video frames, not just a container header");
  const fixture = Buffer.from(media);
  await writeFile(path.join(output, "fixture.webm"), fixture);
  await context.route("**/api/course-media/**/11111111-1111-4111-8111-111111111111", route => {
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    if (!range) return route.fulfill({ contentType: "video/webm", body: fixture });
    const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), fixture.length - 1) : fixture.length - 1;
    return route.fulfill({ status: 206, contentType: "video/webm", headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${fixture.length}` }, body: fixture.subarray(start, end + 1) });
  });
  const previewPath = `/en-GB/portal/courses/${course.id}/public-lesson`;
  await page.goto(origin + previewPath);
  assert(page.url().includes("/sign-in"), "Anonymous preview still requires authentication");
  await context.addCookies([{ name: "learning_guide_session", value: session.token, url: origin }]);
  for (const locale of ["en-GB", "zh-CN"] as const) {
    const copy = getMessages(locale);
    await page.goto(`${origin}/${locale}/portal/courses/${course.id}/public-lesson`, { waitUntil: "networkidle" });
    const reject = page.getByRole("button", { name: copy.legal.rejectOptional, exact: true }); if (await reject.isVisible()) await reject.click();
    assert.equal(await page.locator("h1").innerText(), "Looking closely");
    assert.equal(await page.locator(".portal-header").count(), 1);
    assert.equal(await page.locator(".portal-footer").count(), 1);
    assert.equal(await page.getByRole("button", { name: new RegExp(copy.previewVideoDesign.understanding) }).isDisabled(), true);
    assert(!await page.getByRole("link", { name: /Objects and memory/ }).count());
    assert(!(await page.content()).includes("PRIVATE_BODY_SENTINEL"));
    assert(await page.locator(".la-video-badge").isVisible());
    await page.screenshot({ path: path.join(output, `${locale}-desktop.png`), fullPage: true });
    await page.getByRole("button", { name: copy.previewVideoDesign.play, exact: true }).click();
    try { await page.waitForFunction(() => document.querySelector("video")!.currentTime > 0, undefined, { timeout: 10000 }); }
    catch (error) { console.log(await page.locator("video").evaluate((video: HTMLVideoElement) => ({ source: video.currentSrc, error: video.error?.message, state: video.readyState, time: video.currentTime }))); throw error; }
    await page.locator("video").evaluate((video: HTMLVideoElement) => {
      video.pause(); Object.defineProperty(video, "currentTime", { configurable: true, value: 61, writable: true }); video.dispatchEvent(new Event("timeupdate"));
    });
    await page.getByRole("dialog").waitFor();
    assert.equal(await page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime), 60);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: /1.2 Read visual cues/ }).click();
    assert.equal(await page.locator("video").count(), 0);
    await page.getByText("Observe the composition.", { exact: true }).waitFor();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(200);
    assert.equal(await page.getByRole("dialog").count(), 0, "Text content must not trigger the preview-limit modal");
    await page.getByRole("button", { name: /1.1 Observe composition/ }).click();
    const complete = page.getByRole("button", { name: copy.learning.completeLesson, exact: true });
    if (await complete.count()) await complete.click();
    await page.getByRole("button", { name: copy.learning.completed, exact: true }).waitFor();
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow at ${locale} ${width}`);
    }
    await page.screenshot({ path: path.join(output, `${locale}-mobile.png`), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
    const privateResponse = await context.request.get(`${origin}/${locale}/portal/courses/${course.id}/public-lesson?lessonId=private-lesson`);
    assert.equal(privateResponse.status(), 404);
    // Reset the fixture's preview completion between locale runs.
    const current = await store.ensureProductData(); current.studyRecords = []; current.studyEvents = [];
    await files.atomicWriteJson(productFile, current);
  }
  const entitledData = await store.ensureProductData();
  entitledData.entitlements.push({ id: "preview-test-entitlement", userId: user.id, courseId: course.id, state: "active", source: "purchase", scope: "course", scopeId: course.id, validTo: new Date(Date.now() + 86400000).toISOString() });
  await files.atomicWriteJson(productFile, entitledData);
  await page.goto(origin + previewPath, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".la-video-badge").count(), 0);
  assert(await page.getByRole("link", { name: /Objects and memory/ }).count());
  await page.getByRole("button", { name: /Check your understanding/ }).click();
  await page.getByRole("dialog").waitFor();
  assert(await page.getByText("What do you notice?", { exact: true }).isVisible());
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: /Explore further/ }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByText("Look for shapes and colours.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  assert((await page.getByRole("link", { name: /Ask AI Tutor/ }).getAttribute("href"))?.includes("/account/learn/"));
  const expired = await store.ensureProductData();
  expired.entitlements.find(item => item.id === "preview-test-entitlement")!.validTo = new Date(Date.now() - 1000).toISOString();
  await files.atomicWriteJson(productFile, expired);
  await page.goto(origin + previewPath, { waitUntil: "networkidle" });
  assert(await page.getByRole("button", { name: /Check your understanding/ }).isDisabled());
  assert(!await page.getByRole("link", { name: /Objects and memory/ }).count());
  assert.deepEqual(errors, []);
  console.log("PASS: shared shell, bilingual desktop/mobile preview, real video playback, trial boundary, content switching, completion and private/anonymous access");
} finally {
  await browser.close(); server.kill(); process.chdir(repo);
}
}

main().catch(error => { console.error(error); process.exitCode = 1; });

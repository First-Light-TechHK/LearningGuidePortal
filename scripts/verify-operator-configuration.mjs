import assert from "node:assert/strict";
import { mkdtemp, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

// A separate data directory prevents this operator test changing the developer's portal settings.
const root = process.cwd();
const fixture = await mkdtemp(path.join(tmpdir(), "lg-operator-"));
const port = Number(process.env.TEST_PORT || 3039);
const base = `http://127.0.0.1:${port}`;
const email = `operator.${Date.now()}@example.test`;
let server;
let browser;
try {
  for (const name of [".next", "node_modules", "public", "package.json"]) await symlink(path.join(root, name), path.join(fixture, name));
  server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: fixture, stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "production", APP_ENV: "DEV", PAYMENT_MODE: "demo", EMAIL_VERIFICATION_REQUIRED: "0", LOCAL_SOCIAL_LOGIN: "1", STORAGE_BACKEND: "local", BACKOFFICE_OPERATOR_EMAIL: email, NEXT_PUBLIC_APP_URL: base },
  });
  let output = "";
  server.stdout.on("data", data => { output += data; }); server.stderr.on("data", data => { output += data; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(output);
    try { ready = (await fetch(`${base}/api/health/config`)).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, output);
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const api = context.request;
  assert.equal((await api.get(`${base}/api/backoffice/portal`)).status(), 403);
  assert.equal((await api.post(`${base}/api/auth/register`, { data: { email, password: "TestPass123!", nickname: "Operator Test" } })).status(), 200);
  const page = await context.newPage();
  await page.goto(`${base}/en-GB/backoffice/portal`, { waitUntil: "networkidle" });
  const title = page.locator(".portal-content-editor fieldset").first().locator("input").nth(2);
  await title.fill("Operator saved banner");
  const response = page.waitForResponse(response => response.url().endsWith("/api/backoffice/portal") && response.request().method() === "PUT");
  await page.locator(".portal-content-editor > button").click();
  assert.equal((await response).status(), 200);
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await title.inputValue(), "Operator saved banner");
  const saved = await (await api.get(`${base}/api/backoffice/portal`)).json();
  assert.equal(saved.content.banners["en-GB"][0].title, "Operator saved banner");
  await page.goto(`${base}/en-GB/portal`, { waitUntil: "networkidle" });
  assert.ok((await page.locator(".portal-banner-content").innerText()).includes("Operator saved banner"));
  const courseResult = await api.post(`${base}/api/backoffice/courses`, { data: { title: "Operator test course", description: "Test lesson metadata", category: "Science" } });
  assert.equal(courseResult.status(), 200);
  const { course } = await courseResult.json();
  const lessonData = { title: "Measured lesson", body: "A lesson for the isolated test.", durationMinutes: 30, videoDurationSeconds: 120, isPublic: true };
  assert.equal((await api.post(`${base}/api/backoffice/courses/${course.id}`, { data: { ...lessonData, videoDurationSeconds: -1 } })).status(), 400);
  assert.equal((await api.post(`${base}/api/backoffice/courses/${course.id}`, { data: lessonData })).status(), 200);
  assert.equal((await api.patch(`${base}/api/backoffice/courses/${course.id}`, { data: { status: "published" } })).status(), 200);
  await page.goto(`${base}/en-GB/portal/courses?category=Science`, { waitUntil: "networkidle" });
  const card = page.locator(".portal-course-card").filter({ hasText: "Operator test course" });
  assert.ok((await card.locator(".portal-course-meta").innerText()).includes("2 min video"));
  assert.doesNotMatch(await card.innerText(), /30 min video/);
  console.log("PASS: isolated operator UI save/reload, public banner update, authorised publishing, measured video metadata and invalid input rejection. Developer data unchanged.");
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill("SIGTERM"); await once(server, "exit"); }
  await rm(fixture, { recursive: true, force: true });
}

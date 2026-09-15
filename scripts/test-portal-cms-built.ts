// Actual production-build browser smoke; separate temporary storage and port 3018.
// Translation is deliberately unconfigured. No live provider calls or response mocks.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setDefaultResultOrder } from "node:dns";
import { chromium, type Browser } from "playwright";
import { getMessages } from "../lib/i18n/messages";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 3018, origin = `http://localhost:${port}`;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
setDefaultResultOrder("ipv4first");

async function main() {
  assert.equal(process.env.LGTEACHER_BUILD_READY, "1", "Parent must confirm the combined build is ready.");
  const dist = process.env.NEXT_DIST_DIR || ".next";
  const buildId = (await readFile(path.join(repo, dist, "BUILD_ID"), "utf8")).trim();
  const socket = createServer();
  await new Promise<void>((resolve, reject) => { socket.once("error", reject); socket.listen(port, "127.0.0.1", resolve); });
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const temporary = await mkdtemp(path.join(tmpdir(), "portal-cms-built-store-"));
  const artefacts = await mkdtemp(path.join(tmpdir(), "portal-cms-built-report-"));
  let server: ChildProcess | undefined, browser: Browser | undefined, logs = "";
  const errors: string[] = [];
  try {
    process.chdir(temporary);
    Object.assign(process.env, { STORAGE_BACKEND: "local", APP_ENV: "test", ADMIN_HOSTS: "localhost", PAYMENT_MODE: "demo", LOCAL_EMAIL_PREVIEW: "1", NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`, BACKOFFICE_OPERATOR_EMAIL: "operator@portal-cms-browser.test", LOCAL_SOCIAL_LOGIN: "0", OPENROUTER_API_KEY: "", NEXT_DIST_DIR: dist });
    const store = await import("../services/productStore");
    const user = await store.registerUser({ email: "operator@portal-cms-browser.test", password: "browser-regression1" });
    await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
    server = spawn(process.execPath, [path.join(repo, "node_modules/next/dist/bin/next"), "start", repo, "-p", String(port), "--hostname", "127.0.0.1"], { cwd: temporary, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout!.on("data", chunk => { logs += chunk; }); server.stderr!.on("data", chunk => { logs += chunk; });
    for (let attempt = 0; ; attempt++) {
      assert(server.exitCode === null && server.signalCode === null, logs);
      assert(attempt < 120, "Server did not start: " + logs);
      try { if ((await fetch(`${origin}/en-GB/backoffice/sign-in`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch { /* bounded startup */ }
      await delay(300);
    }
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    const messages = getMessages("en-GB"), copy = messages.portalEditor;
    await page.goto(`${origin}/en-GB/backoffice/courses`, { waitUntil: "networkidle" });
    assert.equal(new URL(page.url()).pathname, "/en-GB/backoffice/sign-in");
    const consent = page.getByRole("button", { name: messages.legal.rejectOptional, exact: true });
    if (await consent.count() && await consent.isVisible()) await consent.click();
    await page.getByLabel(messages.auth.email, { exact: true }).fill("operator@portal-cms-browser.test");
    await page.locator(".auth-credential-form input[type=password]").fill("browser-regression1");
    await page.getByRole("button", { name: messages.auth.submitSignIn, exact: true }).click();
    await page.waitForURL(`${origin}/en-GB/backoffice/courses`);
    await page.getByRole("link", { name: copy.heading, exact: true }).click();
    await page.waitForURL(`${origin}/en-GB/backoffice/portal`);
    const form = page.locator(".portal-content-editor"), dialog = page.getByRole("dialog");
    const titles = form.getByLabel(copy.title, { exact: true });
    await titles.first().fill("Built CMS English heading"); await titles.nth(1).fill("Built CMS Chinese heading");
    const translateResponse = page.waitForResponse(response => response.url().endsWith("/api/backoffice/portal/translate"));
    await form.getByRole("button", { name: copy.translateOnce, exact: true }).click();
    assert.equal((await translateResponse).status(), 503);
    await form.getByRole("alert").waitFor();
    assert.equal(await titles.first().inputValue(), "Built CMS English heading");
    await form.getByRole("button", { name: copy.chooseImage, exact: true }).first().click();
    await dialog.waitFor(); assert.equal(await dialog.evaluate(el => el.matches(":modal")), true);
    await dialog.locator(".portal-image-library-grid button").first().waitFor();
    await dialog.locator('input[type=file]').setInputFiles({ name: "invalid.png", mimeType: "image/png", buffer: Buffer.from("Invalid image regression fixture") });
    await dialog.getByRole("alert").waitFor();
    assert.equal(await dialog.getByRole("button", { name: copy.uploadImage, exact: true }).isEnabled(), true);
    await page.screenshot({ path: path.join(artefacts, "desktop-upload-error.png"), fullPage: true });
    const uploadResponse = page.waitForResponse(response => response.url().endsWith("/api/backoffice/portal/media") && response.request().method() === "POST");
    await dialog.locator('input[type=file]').setInputFiles({ name: "a".repeat(76) + ".jpg", mimeType: "image/jpeg", buffer: await readFile(path.join(repo, "public/portal/course-book.jpg")) });
    const uploaded = await uploadResponse; assert.equal(uploaded.status(), 201, await uploaded.text());
    const asset = (await uploaded.json()).asset;
    await dialog.waitFor({ state: "detached" });
    assert.equal(await form.locator(".portal-image-picker-row input").first().inputValue(), asset.url);
    const saveResponse = page.waitForResponse(response => response.url().endsWith("/api/backoffice/portal") && response.request().method() === "PUT");
    await form.getByRole("button", { name: copy.save, exact: true }).click();
    const saved = await saveResponse; assert.equal(saved.status(), 200, await saved.text());
    await form.getByText(copy.saved, { exact: true }).waitFor();
    const persistedResponse = await context.request.get(`${origin}/api/backoffice/portal`);
    assert.equal(persistedResponse.status(), 200); const persisted = (await persistedResponse.json()).content;
    assert.equal(persisted.banners["en-GB"][0].title, "Built CMS English heading");
    assert.equal(persisted.banners["zh-CN"][0].title, "Built CMS Chinese heading");
    assert.equal(persisted.banners["en-GB"][0].image, asset.url); assert.equal(persisted.banners["zh-CN"][0].image, asset.url);
    assert.equal((await context.request.get(`${origin}${asset.url}`)).status(), 200);
    await page.reload({ waitUntil: "networkidle" }); assert.equal(await titles.first().inputValue(), "Built CMS English heading");
    for (const locale of ["en-GB", "zh-CN"] as const) for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(`${origin}/${locale}/backoffice/portal`, { waitUntil: "networkidle" });
      const local = getMessages(locale).portalEditor;
      await form.getByRole("button", { name: local.chooseImage, exact: true }).first().click();
      const image = dialog.getByRole("button", { name: "a".repeat(76) + ".jpg", exact: true }); await image.waitFor();
      assert(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), "Library horizontal overflow");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Page horizontal overflow");
      await page.screenshot({ path: path.join(artefacts, `library-${locale}-${width}.png`), fullPage: true });
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), local.chooseImage);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, mode: "actual-production-build-no-mocks", port, buildId, liveProviderCalls: 0, checks: ["admin form login", "CMS link navigation", "translation unconfigured error", "real invalid upload feedback", "real image upload", "bilingual save and reload", "shared image persistence", "desktop/mobile EN/ZH dialog and focus"], artefacts, errors }, null, 2));
  } catch (error) {
    const page = browser?.contexts()[0]?.pages()[0];
    await page?.screenshot({ path: path.join(artefacts, "failure.png"), fullPage: true }).catch(() => undefined);
    console.error("CMS failure artefacts:", artefacts); throw error;
  } finally {
    await browser?.close();
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = new Promise<void>(resolve => server!.once("exit", () => resolve())); server.kill("SIGTERM");
      if (!await Promise.race([exited.then(() => true), delay(5000).then(() => false)])) { server.kill("SIGKILL"); await exited; }
    }
    await writeFile(path.join(artefacts, "server.log"), logs);
    process.chdir(repo); await rm(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

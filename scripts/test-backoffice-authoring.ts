import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { chromium } from "playwright";

async function main() {
  const repo = process.cwd(), temporary = await mkdtemp(path.join(tmpdir(), "lg-authoring-ui-"));
  const port = 3014, origin = `http://127.0.0.1:${port}`;
  process.chdir(temporary);
  process.env.STORAGE_BACKEND = "local";
  process.env.BACKOFFICE_OPERATOR_EMAIL = "authoring@example.test";
  const store = await import("../services/productStore");
  const user = await store.registerUser({ email: "authoring@example.test", password: "test-password1" });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  const session = await store.createSession(user.id);
  await store.createCourseForOperator({ title: "Authoring browser test" });
  const server = spawn(process.execPath, [path.join(repo, "node_modules/next/dist/bin/next"), "start", repo, "-p", String(port), "--hostname", "127.0.0.1"], { cwd: temporary, env: { ...process.env, APP_ENV: "DEV", PAYMENT_MODE: "demo" }, stdio: ["ignore", "ignore", "inherit"] });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (server.exitCode != null) throw new Error("Preview server exited");
      try { if ((await fetch(`${origin}/en-GB/portal`)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert(ready);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.context().addCookies([{ name: "learning_guide_session", value: session.token, url: origin }]);
    await page.goto(`${origin}/en-GB/backoffice/courses`);
    const cookieChoice = page.getByRole("button", { name: "Use essential cookies only", exact: true });
    if (await cookieChoice.isVisible()) await cookieChoice.click();
    const row = page.locator(".backoffice-course-row").filter({ hasText: "Authoring browser test" });
    await row.getByRole("button", { name: "Edit course outline" }).click();
    const editor = page.locator(".authoring-editor");
    await editor.getByRole("button", { name: "Add section", exact: true }).click();
    await editor.getByLabel("Section title", { exact: true }).fill("New section from browser");
    await editor.getByRole("button", { name: "Add lesson", exact: true }).click();
    await editor.getByLabel("Lesson title", { exact: true }).fill("Saved lesson");
    await editor.getByLabel("Lesson content", { exact: true }).fill("This text is persisted through the draft API.");
    await editor.getByLabel("Public first lesson", { exact: true }).check();
    await editor.screenshot({ path: "/tmp/lg-authoring-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await editor.screenshot({ path: "/tmp/lg-authoring-mobile.png" });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith("/draft") && r.request().method() === "PUT"),
      editor.getByRole("button", { name: "Save draft", exact: true }).click(),
    ]);
    assert.equal(response.status(), 200);
    await editor.waitFor({ state: "detached" });
    await page.reload();
    await row.getByText("Saved lesson", { exact: false }).waitFor();
    console.log("PASS: operator browser editor, section/lesson creation, responsive layout and persistent API save");
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
    await new Promise<void>(resolve => { if (server.exitCode != null) resolve(); else server.once("exit", () => resolve()); });
    process.chdir(repo);
    await rm(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

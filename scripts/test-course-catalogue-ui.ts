import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { getMessages } from "../lib/i18n/messages";
import { getCourseManagementMessages } from "../lib/i18n/courseManagementMessages";

const repo = process.cwd(), port = Number(process.env.CATALOGUE_TEST_PORT || 3098), origin = "http://localhost:" + port;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  assert.equal(process.env.LGTEACHER_BUILD_READY, "1", "Run only after the combined production build passes.");
  await access(path.join(repo, process.env.NEXT_DIST_DIR || ".next", "BUILD_ID"));
  const socket = createServer();
  await new Promise<void>((resolve, reject) => { socket.once("error", reject); socket.listen(port, "127.0.0.1", resolve); });
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const directory = await mkdtemp(path.join(tmpdir(), "lg-catalogue-ui-store-"));
  const artefacts = await mkdtemp(path.join(tmpdir(), "lg-catalogue-ui-report-"));
  process.chdir(directory);
  Object.assign(process.env, { STORAGE_BACKEND: "local", APP_ENV: "DEV", ADMIN_HOSTS: "localhost", PAYMENT_MODE: "demo", BACKOFFICE_OPERATOR_EMAIL: "operator@catalogue-ui.test", NEXT_PUBLIC_APP_URL: origin });
  const store = await import("../services/productStore");
  const operator = await store.registerUser({ email: "operator@catalogue-ui.test", password: "password1" });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(operator.id));
  const teacher = await store.registerUser({ email: "teacher@catalogue-ui.test", password: "password1" });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(teacher.id));
  const token = (await store.createSession(operator.id)).token;
  const teacherToken = (await store.createSession(teacher.id)).token;
  let course = await store.createCourseForOperator({ title: "Catalogue UI course", description: "Initial description" }, operator.id);
  await store.addLessonToCourse({ courseId: course.id, title: "Historical lesson", body: "Historical lesson body", durationMinutes: 10, isPublic: true }, operator.id);
  course = await store.getCourseForAuthor(operator.id, course.id);
  const retainedLesson = course.sections[0].lessons[0];
  const server = spawn(process.execPath, [path.join(repo, "node_modules/next/dist/bin/next"), "start", repo, "-p", String(port), "--hostname", "127.0.0.1"], { cwd: directory, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
  let logs = ""; server.stdout?.on("data", chunk => { logs += chunk; }); server.stderr?.on("data", chunk => { logs += chunk; });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    for (let attempt = 0; ; attempt++) {
      if (server.exitCode !== null) throw new Error(logs);
      try { if ((await fetch(origin + "/api/backoffice/courses")).status === 403) break; } catch {}
      if (attempt > 90) throw new Error("Server did not start: " + logs);
      await delay(500);
    }
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: "learning_guide_session", value: token, url: origin }]);
    const page = await context.newPage(), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => { void dialog.accept(); });
    const c = getCourseManagementMessages("en-GB"), a = getMessages("en-GB").authoring;
    async function signIn(target: Page, email: string) {
      await target.goto(origin + "/en-GB/backoffice/courses", { waitUntil: "networkidle" });
      assert.equal(new URL(target.url()).pathname, "/en-GB/backoffice/sign-in", "Learner cookie must not sign into admin");
      const copy = getMessages("en-GB");
      const cookie = target.getByRole("button", { name: copy.legal.rejectOptional, exact: true });
      if (await cookie.count() && await cookie.isVisible()) await cookie.click();
      await target.getByLabel(copy.auth.email, { exact: true }).fill(email);
      await target.locator(".auth-credential-form input[type=password]").fill("password1");
      await target.getByRole("button", { name: copy.auth.submitSignIn, exact: true }).click();
      await target.waitForURL(origin + "/en-GB/backoffice/courses");
      const cookies = await target.context().cookies(origin);
      assert.ok(cookies.some(item => item.name === "learning_guide_admin_session" && item.httpOnly));
      assert.equal((await target.context().request.get(origin + "/api/auth/me", { maxRedirects: 0 })).status(), 307, "Admin host must not expose learner account APIs");
    }
    await signIn(page, operator.email!);
    const api = async (url: string) => {
      const response = await context.request.get(origin + url);
      assert.equal(response.status(), 200, await response.text()); return response.json();
    };
    assert.equal((await api("/api/backoffice/courses/" + course.id)).course.title, course.title);
    await page.getByRole("button", { name: c.catalogue, exact: true }).click();
    await page.getByRole("button", { name: c.createCategory, exact: true }).click();
    await page.getByLabel(c.name, { exact: true }).fill("Catalogue browser category");
    await page.getByRole("button", { name: c.save, exact: true }).click();
    await page.getByRole("button", { name: c.createCategory, exact: true }).click();
    const entries = (await api("/api/backoffice/courses/catalogue")).entries;
    const categoryId = entries.find((e: { name: string }) => e.name === "Catalogue browser category").id;
    await page.getByLabel(c.category).selectOption(categoryId);
    await page.getByLabel(c.name, { exact: true }).fill("Catalogue browser subject");
    await page.getByRole("button", { name: c.save, exact: true }).click();
    await page.getByText("Catalogue browser subject", { exact: true }).waitFor();
    await page.getByRole("button", { name: c.editCatalogue + ": Catalogue browser subject", exact: true }).click();
    await page.getByLabel(c.name, { exact: true }).fill("Renamed browser subject");
    await page.getByRole("button", { name: c.save, exact: true }).click();
    await page.getByText("Renamed browser subject", { exact: true }).waitFor();
    await page.getByRole("button", { name: c.archive + ": Renamed browser subject", exact: true }).click();
    await page.getByRole("button", { name: c.restore + ": Renamed browser subject", exact: true }).click();
    await page.getByRole("button", { name: c.archive + ": Renamed browser subject", exact: true }).waitFor();
    await page.getByRole("button", { name: c.archive + ": Catalogue browser category", exact: true }).click();
    await page.getByText(c.errors.inUse, { exact: true }).waitFor();
    await page.getByRole("button", { name: getMessages("en-GB").backoffice.courses, exact: true }).click();
    await page.getByRole("button", { name: a.heading, exact: true }).first().waitFor();
    const row = () => page.locator(".backoffice-course-row").filter({ hasText: course.title });
    await row().getByRole("button", { name: a.heading, exact: true }).click();
    const outline = page.locator(".authoring-editor");
    await outline.getByLabel(c.subtitle, { exact: true }).fill("Persisted subtitle");
    await outline.getByLabel(c.category).selectOption(categoryId);
    await outline.getByLabel(c.subject).selectOption({ label: "Renamed browser subject" });
    await outline.getByLabel(c.level).selectOption("advanced");
    await outline.getByLabel(c.referencePrice, { exact: true }).fill("123.45");
    await outline.getByLabel(c.discount, { exact: true }).fill("20");
    await outline.getByLabel(c.tags, { exact: true }).fill("CatalogueSearchTag");
    await outline.getByLabel(c.tags, { exact: true }).press("Enter");
    await outline.getByLabel(c.uploadCover, { exact: true }).setInputFiles(path.join(repo, "public/portal/course-book.jpg"));
    await outline.locator(".course-cover-preview img").waitFor();
    await outline.getByRole("button", { name: a.save, exact: true }).click();
    await outline.waitFor({ state: "detached" });
    course = (await api("/api/backoffice/courses/" + course.id)).course;
    assert.equal(course.subtitle, "Persisted subtitle"); assert.equal(course.referencePrice, 123.45); assert.equal(course.discount, 20); assert.equal(course.level, "advanced");
    assert.deepEqual(course.tags, ["CatalogueSearchTag"]); assert.match(course.cover!, /^\/api\/course-media\//);
    await page.getByLabel(c.search, { exact: true }).fill("CatalogueSearchTag");
    await page.waitForResponse(response => response.url().includes("search=CatalogueSearchTag") && response.request().method() === "GET");
    assert.equal(await page.locator(".backoffice-course-row").count(), 1);
    await page.getByLabel(c.level).selectOption("beginner");
    await page.getByText(c.empty, { exact: true }).waitFor();
    assert.equal(await page.locator(".backoffice-course-row").count(), 0);
    await page.getByLabel(c.level).selectOption("advanced");
    await row().waitFor();
    await page.getByLabel(c.category).selectOption(categoryId);
    await page.waitForResponse(response => response.url().includes("categoryId=" + categoryId) && response.request().method() === "GET");
    assert.equal(await page.locator(".backoffice-course-row").count(), 1);
    await row().getByRole("button", { name: c.ownership + ": " + course.title, exact: true }).click();
    await page.getByLabel(c.ownerEmail, { exact: true }).fill(teacher.email!);
    await page.getByRole("button", { name: c.assignOwner, exact: true }).click();
    await page.getByText(c.ownerAssigned, { exact: true }).waitFor();
    course = (await api("/api/backoffice/courses/" + course.id)).course;
    assert.deepEqual(course.authorIds, [teacher.id]);
    await row().getByRole("button", { name: c.archive + ": " + course.title, exact: true }).click();
    await row().getByRole("button", { name: c.restore, exact: true }).waitFor();
    await row().getByRole("button", { name: c.restore, exact: true }).click();
    await row().getByRole("button", { name: a.heading, exact: true }).click();
    if (await outline.locator(".authoring-lesson").first().getAttribute("open") === null) await outline.locator(".authoring-lesson summary").first().click();
    await outline.getByRole("button", { name: c.removeLesson, exact: true }).click();
    await outline.getByRole("button", { name: a.save, exact: true }).click();
    await outline.waitFor({ state: "detached" });
    course = (await api("/api/backoffice/courses/" + course.id)).course;
    assert.deepEqual(course.archivedSections!.flatMap(s => s.lessons).find(l => l.id === retainedLesson.id), retainedLesson);
    for (const locale of ["en-GB", "zh-CN"] as const) for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(origin + "/" + locale + "/backoffice/courses", { waitUntil: "networkidle" });
      const create = page.getByRole("button", { name: getMessages(locale).backoffice.create, exact: true });
      assert(await create.evaluate(button => { const style = getComputedStyle(button); return button.getBoundingClientRect().width >= 70 && style.color !== style.backgroundColor && button.scrollWidth <= button.clientWidth + 2; }), "Create button must be legible and contain its label");
      await page.screenshot({ path: path.join(artefacts, locale + "-" + width + ".png"), fullPage: true });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Horizontal overflow: " + locale + "/" + width);
    }
    const teacherContext = await browser.newContext();
    await teacherContext.addCookies([{ name: "learning_guide_session", value: teacherToken, url: origin }]);
    const teacherPage = await teacherContext.newPage();
    await signIn(teacherPage, teacher.email!);
    assert.equal(await teacherPage.getByRole("link", { name: c.aiSettings, exact: true }).count(), 0);
    assert.equal(await teacherPage.getByRole("link", { name: getMessages("en-GB").backoffice.orders.title, exact: true }).count(), 0);
    await teacherPage.locator("#author-profile summary").click();
    assert.ok((await teacherPage.locator("#author-profile").innerText()).includes(teacher.email!));
    assert.equal((await teacherContext.request.get(origin + "/api/backoffice/portal")).status(), 403);
    assert.equal((await teacherContext.request.get(origin + "/api/backoffice/orders")).status(), 403);
    assert.equal((await teacherContext.request.get(origin + "/knowledge/philosophy/epicureanism/chat-testing")).status(), 404);
    await teacherPage.getByRole("button", { name: getMessages("en-GB").learning.signOut, exact: true }).click();
    await teacherPage.waitForURL(origin + "/en-GB/backoffice/sign-in");
    assert.equal((await teacherContext.cookies(origin)).some(item => item.name === "learning_guide_admin_session"), false);
    assert.equal((await teacherContext.request.get(origin + "/api/backoffice/courses")).status(), 403);
    assert.deepEqual(errors, []);
    console.log("PASS catalogue, metadata, cover upload, search, ownership, archive/restore, lesson archive, bilingual responsive pages, separate admin form login, teacher boundaries and logout");
    console.log("Screenshots: " + artefacts);
  } catch (error) {
    const page = browser?.contexts()[0]?.pages()[0];
    if (page) {
      await page.screenshot({ path: path.join(artefacts, "failure.png"), fullPage: true }).catch(() => undefined);
      console.error(await page.locator("body").innerText().catch(() => "No page text"));
    }
    console.error("Failure artefacts: " + artefacts);
    throw error;
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
    await Promise.race([new Promise(resolve => server.once("exit", resolve)), delay(5000)]);
    if (server.exitCode === null) { server.kill("SIGKILL"); await delay(200); }
    await writeFile(path.join(artefacts, "server.log"), logs);
    process.chdir(repo);
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

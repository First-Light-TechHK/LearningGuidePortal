import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { tmpdir } from "node:os";
import path from "node:path";
import { getOverviewDisplay } from "../../services/overviewDisplay";
import type { OverviewDisplayCourse } from "../../contracts/overview-display";

const cwd = process.cwd(), oldBackend = process.env.STORAGE_BACKEND;
let directory: string;
let store: typeof import("../../services/productStore");
let put: typeof import("../../app/api/courses/[courseId]/learning-mode/route").PUT;
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lg-learning-mode-"));
  process.chdir(directory); process.env.STORAGE_BACKEND = "local";
  store = await import("../../services/productStore");
  put = (await import("../../app/api/courses/[courseId]/learning-mode/route")).PUT;
});
after(async () => {
  process.chdir(cwd);
  if (oldBackend === undefined) delete process.env.STORAGE_BACKEND; else process.env.STORAGE_BACKEND = oldBackend;
  await rm(directory, { recursive: true, force: true });
});

test("service persists per-account per-course preference without granting access", async () => {
  const user = await store.registerUser({ email: "mode@example.test", password: "password1" });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  assert.equal(await store.getCourseLearningMode(user.id, "epicureanism"), null);
  const before = structuredClone((await store.ensureProductData()).entitlements);
  await store.saveCourseLearningMode(user.id, "epicureanism", "text");
  await store.saveCourseLearningMode(user.id, "epicureanism", "text");
  assert.equal(await store.getCourseLearningMode(user.id, "epicureanism"), "text");
  assert.equal(await store.getCourseLearningMode(user.id, "stoicism"), null);
  assert.equal(await store.getCourseLearningMode("other-user", "epicureanism"), null);
  assert.deepEqual((await store.ensureProductData()).entitlements, before);
  assert.equal((await store.checkEntitlement(user.id, "epicureanism")).allowed, false);
  await assert.rejects(store.saveCourseLearningMode(user.id, "epicureanism", "invalid"));
  await assert.rejects(store.saveCourseLearningMode(user.id, "missing-course", "video"));
  await assert.rejects(store.saveCourseLearningMode("missing-user", "epicureanism", "video"));
});

test("API validates sessions, origins and input; two browser sessions share saved preference", async () => {
  const user = await store.registerUser({ email: "browser-mode@example.test", password: "password1" });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  const first = (await store.createSession(user.id)).token, second = (await store.createSession(user.id)).token;
  const invoke = (token: string, mode: unknown, origin = "http://localhost:3014", courseId = "epicureanism") => put(new Request(`http://localhost:3014/api/courses/${courseId}/learning-mode`, {
    method: "PUT", headers: { origin, cookie: `learning_guide_session=${token}` }, body: JSON.stringify({ mode }),
  }), { params: Promise.resolve({ courseId }) });
  assert.equal((await invoke("", "video")).status, 401);
  assert.equal((await invoke(first, "video", "https://other.test")).status, 403);
  for (const invalid of [null, "lecture", {}, 1]) assert.equal((await invoke(first, invalid)).status, 400);
  assert.equal((await invoke(first, "video", undefined, "missing-course")).status, 404);
  assert.equal((await invoke(first, "video")).status, 200);
  const secondUser = await store.getUserBySessionToken(second);
  assert.equal(await store.getCourseLearningMode(secondUser!.id, "epicureanism"), "video");
  assert.equal((await invoke(second, "text")).status, 200);
  assert.equal(await store.getCourseLearningMode(user.id, "epicureanism"), "text");
});

test("preview and formal preferences survive purchase, expiry and repurchase independently; stale contexts cannot write", async () => {
  const user = await store.registerUser({ email: "split-mode@example.test", password: "password1" });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  const token = (await store.createSession(user.id)).token;
  const save = (mode: string, accessContext: unknown) => put(new Request("http://localhost:3014/api/courses/modeling-life/learning-mode", {
    method: "PUT", headers: { origin: "http://localhost:3014", cookie: `learning_guide_session=${token}` }, body: JSON.stringify({ mode, accessContext }),
  }), { params: Promise.resolve({ courseId: "modeling-life" }) });
  const initial = structuredClone(await store.ensureProductData());
  assert.equal((await save("video", "preview")).status, 200);
  assert.equal(await store.getCourseLearningMode(user.id, "modeling-life"), "video");
  assert.equal((await save("text", "entitled")).status, 409, "a forged context cannot establish a formal preference");
  assert.equal((await save("text", "paid")).status, 400);
  const { quote } = await store.createQuote(user.id, "science-pc-6");
  const pending = await store.createPendingDemoOrder(user.id, quote.id);
  assert.equal(await store.getCourseLearningMode(user.id, "modeling-life"), "video", "pending purchase is still preview");
  await store.completeDemoOrder(user.id, pending.order.id);
  assert.equal(await store.getCourseLearningMode(user.id, "modeling-life"), null, "purchase requires a fresh formal choice");
  const beforeStale = structuredClone(await store.ensureProductData());
  assert.equal((await save("video", "preview")).status, 409, "an old preview tab cannot write a formal choice after purchase");
  assert.deepEqual(await store.ensureProductData(), beforeStale);
  assert.equal((await save("text", "entitled")).status, 200);
  assert.equal(await store.getCourseLearningMode(user.id, "modeling-life"), "text");
  let data = await store.ensureProductData();
  assert.deepEqual(data.users.find(item => item.id === user.id)?.courseLearningModePreferences?.["modeling-life"], { preview: "video", entitled: "text" });
  assert.deepEqual(data.studyRecords, initial.studyRecords);
  assert.deepEqual(data.studyEvents, initial.studyEvents);
  for (const row of [...data.subscriptions, ...data.entitlements].filter(row => row.userId === user.id)) row.validTo = "2020-01-01T00:00:00Z";
  await writeFile(path.join(directory, "data/knowledge_system/learning_guide/product.json"), JSON.stringify(data));
  assert.equal(await store.getCourseLearningMode(user.id, "modeling-life"), "video", "expiry restores the independent preview preference");
  assert.equal((await save("text", "entitled")).status, 409);
  assert.equal((await save("text", "preview")).status, 200);
  data = await store.ensureProductData();
  assert.equal(data.users.find(item => item.id === user.id)?.courseLearningModePreferences?.["modeling-life"]?.entitled, "text");
  const repurchase = await store.createQuote(user.id, "science-pc-6"); await store.completeDemoCheckout(user.id, repurchase.quote.id);
  assert.equal(await store.getCourseLearningMode(user.id, "modeling-life"), "text");
});

test("legacy shared preview preferences cannot suppress formal choice, while verified formal history remains usable", async () => {
  const user = await store.registerUser({ email: "legacy-split-mode@example.test", password: "password1" });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  const data = await store.ensureProductData();
  data.users.find(item => item.id === user.id)!.courseLearningModes = { "modeling-life": "video" };
  await writeFile(path.join(directory, "data/knowledge_system/learning_guide/product.json"), JSON.stringify(data));
  const { quote } = await store.createQuote(user.id, "science-pc-6"); await store.completeDemoCheckout(user.id, quote.id);
  assert.equal(await store.getCourseLearningMode(user.id, "modeling-life"), null);
  const course = (await store.getProductCourse("modeling-life"))!, lesson = course.sections[0].lessons[0];
  const text = lesson.contents!.find(content => content.type === "text")!;
  await store.recordStudyEvent({ userId: user.id, courseId: course.id, lessonId: lesson.id, contentId: text.id, learningMode: "text", event: "open", seconds: 0, clientEventId: "legacy-formal-mode" });
  assert.equal(await store.getCourseLearningMode(user.id, course.id), "text");
});

test("both locale Course entries prompt again after preview purchase and stop after the formal choice", async () => {
  const user = await store.registerUser({ email: "mode-entry-split@example.test", password: "password1" });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  const course = (await store.getProductCourse("modeling-life"))!, lessonId = store.publicFirstLesson(course)!.id;
  (globalThis as any).splitModeEntry = { user, store };
  const bundle = await build({ absWorkingDir: cwd, entryPoints: ["app/[locale]/portal/courses/[slug]/page.tsx"], bundle: true, write: false,
    platform: "node", format: "cjs", jsx: "automatic", external: ["react/jsx-runtime"], loader: { ".css": "empty" },
    plugins: [{ name: "entry-services", setup(b) {
      b.onResolve({ filter: /^(next\/|@\/services\/|@\/components\/portal\/)/ }, args => ({ path: args.path, namespace: "entry" }));
      b.onLoad({ filter: /.*/, namespace: "entry" }, args => ({ contents:
        args.path.endsWith(".css") ? "export default {}"
        : args.path.endsWith("productStore") ? "export const getLessonBookmarks=(...a)=>globalThis.splitModeEntry.store.getLessonBookmarks(...a);export const getCoursePage=(...a)=>globalThis.splitModeEntry.store.getCoursePage(...a);export const getProductCourse=(...a)=>globalThis.splitModeEntry.store.getProductCourse(...a);export const getCourseLearningMode=(...a)=>globalThis.splitModeEntry.store.getCourseLearningMode(...a);export const listPlans=(...a)=>globalThis.splitModeEntry.store.listPlans(...a);"
        : args.path.endsWith("productAuth") ? "export async function currentProductUser(){return globalThis.splitModeEntry.user}"
        : args.path.endsWith("/s3") ? "export async function signCourseMediaUrl(){return ''}"
        : args.path === "next/navigation" ? "export function redirect(url){throw new Error('redirect:'+url)}"
        : args.path.startsWith("next/") ? "export default 'mock-ui'"
        : `export const ${args.path.split("/").pop()}='${args.path.endsWith("CourseLearningModeDialog") ? "mode-dialog" : "mock-ui"}';`
      }));
    } }] });
  const output = path.join(cwd, "test-results/course-learning-mode/split-entry.cjs");
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, bundle.outputFiles[0].text);
  const render = createRequire(import.meta.url)(output).default;
  const chooser = (node: any): any => !node || typeof node !== "object" ? null : Array.isArray(node) ? node.map(chooser).find(Boolean) || null : node.type === "mode-dialog" ? node : chooser(node.props?.children);
  const page = (locale: string, entry = true) => render({ params: Promise.resolve({ locale, slug: course.id }), searchParams: Promise.resolve(entry ? { lessonEntry: lessonId } : {}) });
  try {
    for (const locale of ["en-GB", "zh-CN"]) assert.equal(chooser(await page(locale)).props.accessContext, "preview");
    await store.saveCourseLearningMode(user.id, course.id, "video");
    for (const locale of ["en-GB", "zh-CN"]) await assert.rejects(() => page(locale), /redirect:.*public-lesson/);
    const { quote } = await store.createQuote(user.id, "science-pc-6"); await store.completeDemoCheckout(user.id, quote.id);
    for (const locale of ["en-GB", "zh-CN"]) {
      assert.equal(chooser(await page(locale, false)), null, "opening details alone still does not prompt");
      const dialog = chooser(await page(locale));
      assert.equal(dialog.props.accessContext, "entitled");
      assert.ok(dialog.props.destinationHref.includes("/account/learn/"));
      assert.equal(dialog.props.pendingMode, undefined, "preview choice is not preselected");
    }
    await store.saveCourseLearningMode(user.id, course.id, "text");
    for (const locale of ["en-GB", "zh-CN"]) await assert.rejects(() => page(locale), /redirect:.*account\/learn/);
  } finally { delete (globalThis as any).splitModeEntry; }
});

test("switching a started course updates My Learning before video playback without changing progress or point history", async () => {
  const user = await store.registerUser({ email: "mode-overview@example.test", password: "password1" });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  const { quote } = await store.createQuote(user.id, "science-pc-6");await store.completeDemoCheckout(user.id, quote.id);
  const course = await store.getProductCourse("modeling-life");assert.ok(course);
  const lesson = course.sections[0].lessons[1], text = lesson.contents!.find(content => content.type === "text")!;
  await store.saveCourseLearningMode(user.id, course.id, "video");
  await store.recordStudyEvent({ userId: user.id, courseId: course.id, lessonId: lesson.id, contentId: text.id, learningMode: "text", event: "open", seconds: 0, clientEventId: "mode-sync-text" });
  assert.equal((await getOverviewDisplay(user.id, user.nickname, "en-GB")).courses.find(card => card.courseId === course.id)?.mode, "text", "existing Study modes retain priority over older entry preferences until an explicit switch");
  const before = structuredClone(await store.ensureProductData()), previous = before.studyRecords.find(record => record.userId === user.id)!;
  assert.equal(previous.progress, 0);
  for (const mode of ["video", "text"] as const) {
    await store.saveCourseLearningMode(user.id, course.id, mode);
    const card: OverviewDisplayCourse = (await getOverviewDisplay(user.id, user.nickname, "en-GB")).courses.find(card => card.courseId === course.id)!;
    assert.equal(card.mode, mode);assert.equal(new URL(card.href, "https://local.test").searchParams.get("viewMode"), mode);
    assert.equal(card.progress, 0);
    const after = await store.ensureProductData(), record = after.studyRecords.find(record => record.userId === user.id)!;
    assert.deepEqual(record.knowledgePositions, previous.knowledgePositions);
    assert.deepEqual(record.highestProgress, previous.highestProgress);
    assert.equal(record.totalSeconds, previous.totalSeconds);assert.equal(record.completedAt, previous.completedAt);
    assert.deepEqual(after.studyEvents, before.studyEvents, "preference changes cannot manufacture Study events");
  }
  await store.saveCourseLearningMode(user.id, course.id, "video");
  await store.recordStudyEvent({ userId: user.id, courseId: course.id, lessonId: lesson.id, contentId: text.id, learningMode: "text", event: "open", seconds: 0, clientEventId: "late-previous-text-request" });
  assert.equal((await getOverviewDisplay(user.id, user.nickname, "en-GB")).courses.find(card => card.courseId === course.id)?.mode, "video", "a late request from the old mode cannot override the explicit selection");
});

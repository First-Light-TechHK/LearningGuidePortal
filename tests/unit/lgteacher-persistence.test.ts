import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CourseDraftInput } from "../../contracts/course-authoring";
import type { LessonContent } from "../../contracts/lesson-content";
import type { ProductCourse, ProductData, ProductUser } from "../../services/productStore";

const cwd = process.cwd();
const environment = { STORAGE_BACKEND: process.env.STORAGE_BACKEND, APP_ENV: process.env.APP_ENV, PAYMENT_MODE: process.env.PAYMENT_MODE, BACKOFFICE_OPERATOR_EMAIL: process.env.BACKOFFICE_OPERATOR_EMAIL };
const origin = "http://127.0.0.1:3016";
let directory: string;
let store: typeof import("../../services/productStore");
let files: typeof import("../../services/fileStore");
let put: typeof import("../../app/api/backoffice/courses/[courseId]/draft/route").PUT;
const token: Record<string, string> = {};
const users: Record<string, ProductUser> = {};
const productFile = () => path.join(directory, "data/knowledge_system/learning_guide/product.json");
const persisted = async (): Promise<ProductData> => JSON.parse(await readFile(productFile(), "utf8"));
const inputFor = (course: ProductCourse): CourseDraftInput => ({ expectedUpdatedAt: course.updatedAt, title: course.title, description: course.description, sections: structuredClone(course.sections) });

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lgteacher-persistence-"));
  process.chdir(directory);
  Object.assign(process.env, { STORAGE_BACKEND: "local", APP_ENV: "DEV", PAYMENT_MODE: "demo", BACKOFFICE_OPERATOR_EMAIL: "operator@lgteacher.test" });
  store = await import("../../services/productStore");
  files = await import("../../services/fileStore");
  put = (await import("../../app/api/backoffice/courses/[courseId]/draft/route")).PUT;
  for (const name of ["operator", "teacher", "foreign", "student", "disabled", "pending"]) {
    users[name] = await store.registerUser({ email: `${name}@lgteacher.test`, password: "regression-password1" });
    if (name !== "pending") await store.verifyEmailToken(await store.issueEmailVerificationToken(users[name].id));
    token[name] = (await store.createSession(users[name].id)).token;
  }
  const seed = await store.ensureProductData();
  for (const name of ["teacher", "foreign", "disabled", "pending"]) seed.users.find(item => item.id === users[name].id)!.role = "teacher";
  seed.users.find(item => item.id === users.disabled.id)!.status = "disabled";
  // Only account-state fixtures bypass APIs. All course mutations use the real services/routes.
  await files.atomicWriteJson(productFile(), seed);
});

after(async () => {
  process.chdir(cwd);
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function invoke(courseId: string, body: unknown, name = "teacher", requestOrigin: string | null = origin) {
  const headers = new Headers({ "content-type": "application/json", host: new URL(origin).host });
  if (token[name]) headers.set("cookie", `learning_guide_session=${token[name]}`);
  if (requestOrigin !== null) headers.set("origin", requestOrigin);
  return put(new Request(`${origin}/api/backoffice/courses/${courseId}/draft`, { method: "PUT", headers, body: JSON.stringify(body) }), { params: Promise.resolve({ courseId }) });
}

test("LGTeacher: real draft route and file store enforce ownership, persistence, stale writes and history", async t => {
  let course = await store.createCourseForOperator({ title: "Persisted teacher course" }, users.teacher.id);
  const contents: LessonContent[] = [{ id: "persisted-text", title: "Rich text", type: "text", mode: "interactive", html: '<p><strong>Persisted bold</strong><script>window.__lgteacherXss=1</script><a data-node-id="persisted-quiz">Open quiz</a></p>', nodes: [
    { id: "persisted-note", title: "Text node", type: "text", triggerTime: 0, html: '<p onmouseover="alert(1)">Persisted explanation</p>' },
    { id: "persisted-quiz", title: "Quiz node", type: "exercise", triggerTime: 2, question: "Choose two", options: ["One", "Two"], correctOptions: [1] },
  ] }];
  const draft: CourseDraftInput = { ...inputFor(course), sections: [{ id: "new-section", title: "Section", lessons: [{ id: "new-lesson", title: "Lesson", body: "Fallback", durationMinutes: 5, isPublic: true, contents }] }] };

  await t.test("rejects missing, foreign, student, pending and disabled identities without a write", async () => {
    for (const name of ["anonymous", "foreign", "student", "pending", "disabled"]) {
      const before = await persisted();
      const response = await invoke(course.id, draft, name);
      assert.equal(response.status, name === "foreign" ? 404 : 403, name);
      assert.equal((await response.json()).ok, false);
      assert.deepEqual(await persisted(), before, `no mutation by ${name}`);
    }
  });
  await t.test("rejects missing, cross-origin and malformed Origin", async () => {
    for (const invalidOrigin of [null, "https://foreign.test", `${origin}/path`, "null"]) {
      assert.equal((await invoke(course.id, draft, "teacher", invalidOrigin)).status, 403);
    }
  });
  await t.test("teacher saves actual structured content through the route", async () => {
    const response = await invoke(course.id, draft);
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(typeof result.requestId, "string");
    course = (await persisted()).courses.find(item => item.id === course.id)!;
    assert.deepEqual(result.data, course);
    const lesson = course.sections[0].lessons[0];
    assert.match(lesson.id, /^lesson_/);
    assert.match(lesson.contents![0].html!, /<strong>Persisted bold<\/strong>/);
    assert.match(lesson.contents![0].html!, /data-node-id="persisted-quiz"/);
    assert.doesNotMatch(JSON.stringify(lesson.contents), /<script|onmouseover=/);
    assert.deepEqual(lesson.contents![0].nodes[1].correctOptions, [1]);
    assert.equal(lesson.contents![0].nodes[1].triggerTime, 2);
  });
  await t.test("stale save returns 409 and does not alter data or append an activity", async () => {
    const before = await persisted();
    assert.equal((await invoke(course.id, { ...draft, title: "Losing stale title" })).status, 409);
    assert.deepEqual(await persisted(), before);
  });
  await t.test("two competing versions have one winner and one conflict", async () => {
    const base = inputFor(course);
    const responses = await Promise.all([invoke(course.id, { ...base, title: "Concurrent A" }), invoke(course.id, { ...base, title: "Concurrent B" })]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    const winner = await responses.find(response => response.status === 200)!.json();
    course = (await persisted()).courses.find(item => item.id === course.id)!;
    assert.equal(course.title, winner.data.title);
  });
  await t.test("cross-course media is rejected and no part of that draft is saved", async () => {
    const input = inputFor(course);
    input.title = "Must not persist";
    input.sections[0].lessons[0].contents!.push({ id: "foreign-video", title: "Foreign", type: "video", mode: "lecture", url: "/api/course-media/another-course/11111111-1111-4111-8111-111111111111", nodes: [] });
    const before = await persisted();
    assert.equal((await invoke(course.id, input)).status, 400);
    assert.deepEqual(await persisted(), before);
  });
  await t.test("referenced lesson removal and course archival preserve study and conversation history", async () => {
    const lesson = course.sections[0].lessons[0], timestamp = "2026-01-01T00:00:00.000Z";
    const seed = await persisted();
    seed.studyRecords.push({ id: "historical-record", userId: users.student.id, courseId: course.id, startedAt: timestamp, updatedAt: timestamp, currentLessonId: lesson.id, totalSeconds: 25, progress: 8, completedAt: null });
    seed.studyEvents.push({ id: "historical-event", userId: users.student.id, courseId: course.id, lessonId: lesson.id, event: "text_progress", seconds: 25, clientEventId: "history-client-id", createdAt: timestamp });
    seed.conversations.push({ id: "historical-conversation", userId: users.student.id, courseId: course.id, lessonId: lesson.id, mode: "lecture", messages: [], updatedAt: timestamp });
    seed.plans.push({ id: "lgteacher-history-plan", courseId: course.id, name: "Historical regression plan", scope: "course", scopeId: course.id, device: "pc", termMonths: 6, amountMinor: 1000, currency: "usd" });
    await files.atomicWriteJson(productFile(), seed);
    const { quote } = await store.createQuote(users.student.id, "lgteacher-history-plan");
    const order = await store.createPendingDemoOrder(users.student.id, quote.id);
    await store.completeDemoOrder(users.student.id, order.order.id);
    const history = await persisted();
    assert(history.orders.some(item => item.id === order.order.id && item.status === "paid"));
    const input = inputFor(course);
    input.sections[0].lessons = [];
    assert.equal((await invoke(course.id, input)).status, 400, "implicit delete");
    input.removedLessonIds = [lesson.id];
    const response = await invoke(course.id, input);
    assert.equal(response.status, 200, await response.clone().text());
    course = (await response.json()).data;
    assert.deepEqual(course.archivedSections!.flatMap(section => section.lessons).find(item => item.id === lesson.id), lesson);
    await store.setCourseStatus(course.id, "archived", users.teacher.id, course.updatedAt);
    const after = await persisted();
    for (const key of ["studyRecords", "studyEvents", "conversations", "orders", "subscriptions", "entitlements"] as const) assert.deepEqual(after[key], history[key], `${key} retained`);
    assert.equal(after.courses.find(item => item.id === course.id)!.status, "archived");
  });
});

test("LGTeacher: catalogue mutations are real, operator-only, versioned and protect referenced subjects", async () => {
  const category = await store.saveCatalogueEntry(users.operator.id, null, { name: "Regression category" });
  const subject = await store.saveCatalogueEntry(users.operator.id, null, { name: "Regression subject", parentId: category.id });
  await assert.rejects(store.saveCatalogueEntry(users.teacher.id, null, { name: "Forbidden category" }), { code: "restricted" });
  await assert.rejects(store.saveCatalogueEntry(users.operator.id, category.id, { name: category.name, status: "archived", expectedUpdatedAt: category.updatedAt }), { code: "inUse" });
  const course = await store.createCourseForOperator({ title: "Catalogue references", categoryId: category.id, subjectId: subject.id }, users.teacher.id);
  await assert.rejects(store.saveCatalogueEntry(users.operator.id, subject.id, { name: subject.name, status: "archived", expectedUpdatedAt: subject.updatedAt }), { code: "inUse" });
  const renamed = await store.saveCatalogueEntry(users.operator.id, subject.id, { name: "Renamed subject", expectedUpdatedAt: subject.updatedAt });
  await assert.rejects(store.saveCatalogueEntry(users.operator.id, subject.id, { name: "Stale rename", expectedUpdatedAt: subject.updatedAt }), { code: "conflict" });
  await store.setCourseStatus(course.id, "archived", users.teacher.id, course.updatedAt);
  const archived = await store.saveCatalogueEntry(users.operator.id, subject.id, { name: renamed.name, status: "archived", expectedUpdatedAt: renamed.updatedAt });
  assert.equal(archived.status, "archived");
  assert.equal((await persisted()).catalogue!.find(item => item.id === subject.id)!.name, "Renamed subject");
});

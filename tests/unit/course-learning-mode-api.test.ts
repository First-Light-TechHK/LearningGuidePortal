import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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

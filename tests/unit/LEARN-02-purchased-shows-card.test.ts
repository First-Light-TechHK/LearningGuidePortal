import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// LEARN-02 design lock: purchased-never-studied stays off the course list
// (do not write "must show a card"). The handbook also said preview must not
// mint a card; ML-FR-004 / PRD wins on integrate/offline — preview-range
// entry lists a card. That conflict is recorded, not re-locked here.

const PLAN_ID = "epicureanism-pc-6";
const COURSE_ID = "epicureanism";
const PUBLIC_LESSON = "pleasure-and-the-good-life";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-learn-02-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  store = await import("../../services/productStore");
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) {
    await rm(isolatedCwd, { recursive: true, force: true });
  }
});

test("LEARN-02 design: purchased with no studyRecord does not invent a course card", async () => {
  const user = await store.registerUser({
    email: "learn-02-purchased@example.test",
    password: "password1",
    nickname: "Learn Two",
  });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  const quote = await store.createQuote(user.id, PLAN_ID);
  const pending = await store.createPendingDemoOrder(user.id, quote.quote.id);
  await store.completeDemoOrder(user.id, pending.order.id);

  const overview = await store.getLearningOverview(user.id);
  assert.ok(overview.entitlements.length >= 1);
  assert.equal(overview.courses.length, 0);
});

test("LEARN-02 / ML-FR-004: preview-range entry lists a card even without entitlement", async () => {
  const user = await store.registerUser({
    email: "learn-02-preview@example.test",
    password: "password1",
    nickname: "Learn Two",
  });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));

  await store.recordStudyEvent({
    userId: user.id,
    courseId: COURSE_ID,
    lessonId: PUBLIC_LESSON,
    event: "open",
    seconds: 0,
    clientEventId: "preview-open-1",
  }, "preview");

  const overview = await store.getLearningOverview(user.id);
  assert.equal(overview.entitlements.length, 0);
  assert.equal(overview.courses.length, 1);
  assert.equal(overview.courses[0]?.cardState, "previewing");
});

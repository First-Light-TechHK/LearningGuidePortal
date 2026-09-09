import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Break: three video_progress events with fresh clientEventIds each adding
// 300s (LEARN-01 / API-LEARN-001). Same id must stay idempotent (API-LEARN-002).

const PLAN_ID = "epicureanism-pc-6";
const COURSE_ID = "epicureanism";
const LESSON_ID = "pleasure-and-the-good-life";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-learn-01-"));
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

async function entitledUser(email: string) {
  const user = await store.registerUser({ email, password: "password1", nickname: "Learn One" });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  const pending = await store.createPendingDemoTrialOrder(user.id, PLAN_ID);
  await store.completeDemoTrialOrder(user.id, pending.order.id);
  return user;
}

test("LEARN-01: same clientEventId replay does not add seconds twice", async () => {
  const user = await entitledUser("learn-01-idempotent@example.test");
  const payload = {
    userId: user.id,
    courseId: COURSE_ID,
    lessonId: LESSON_ID,
    event: "video_progress" as const,
    seconds: 120,
    clientEventId: "progress-same-id",
  };
  const first = await store.recordStudyEvent(payload);
  const replay = await store.recordStudyEvent(payload);
  assert.equal(first?.totalSeconds, 120);
  assert.equal(replay?.totalSeconds, 120);
});

test("LEARN-01: new clientEventIds cannot inject 300s three times in a burst", async () => {
  const user = await entitledUser("learn-01-inject@example.test");
  let record = await store.recordStudyEvent({
    userId: user.id,
    courseId: COURSE_ID,
    lessonId: LESSON_ID,
    event: "video_progress",
    seconds: 300,
    clientEventId: "progress-burst-1",
  });
  record = await store.recordStudyEvent({
    userId: user.id,
    courseId: COURSE_ID,
    lessonId: LESSON_ID,
    event: "video_progress",
    seconds: 300,
    clientEventId: "progress-burst-2",
  });
  record = await store.recordStudyEvent({
    userId: user.id,
    courseId: COURSE_ID,
    lessonId: LESSON_ID,
    event: "video_progress",
    seconds: 300,
    clientEventId: "progress-burst-3",
  });
  assert.ok(record, "a study record exists");
  assert.ok(record.totalSeconds < 900, `injected ${record.totalSeconds}s from three 300s bursts`);
  assert.ok(record.totalSeconds <= 300, `burst total ${record.totalSeconds}s exceeds one 300s slice`);
});

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Break: unpublish leaves checkEntitlement.allowed while study writes fail
// (LEARN-04 / API-LEARN-003).

const PLAN_ID = "epicureanism-pc-6";
const COURSE_ID = "epicureanism";
const LESSON_ID = "pleasure-and-the-good-life";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-learn-04-"));
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

test("LEARN-04: unpublish denies check and study writes together", async () => {
  const user = await store.registerUser({
    email: "learn-04-unpublish@example.test",
    password: "password1",
    nickname: "Learn Four",
  });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  const quote = await store.createQuote(user.id, PLAN_ID);
  const pending = await store.createPendingDemoOrder(user.id, quote.quote.id);
  await store.completeDemoOrder(user.id, pending.order.id);

  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, true);

  const unpublished = await store.setCourseStatus(COURSE_ID, "draft");
  assert.equal(unpublished.status, "draft");

  const check = await store.checkEntitlement(user.id, COURSE_ID);
  assert.equal(check.allowed, false);

  await assert.rejects(
    () => store.recordStudyEvent({
      userId: user.id,
      courseId: COURSE_ID,
      lessonId: LESSON_ID,
      event: "open",
      seconds: 0,
      clientEventId: "learn-04-after-unpublish",
    }),
    /not available/,
  );

  await store.setCourseStatus(COURSE_ID, "published");
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, true);
});

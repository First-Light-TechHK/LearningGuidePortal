import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeProductData } from "./helpers/my-learning";

// New chat (2026-10-27): the server deletes the signed-in learner's conversation
// for the current course and lesson — Lecture / Socratic no longer keep separate rows,
// so both modes under the same (user, course, lesson) key are wiped together.
// Other users and other lessons must survive.

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-ai-tutor-new-chat-"));
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

test("deleteConversation removes all rows for the current learner's course/lesson (both modes) and is idempotent", async () => {
  const timestamp = "2026-10-22T10:00:00.000Z";
  const data = await store.ensureProductData();
  data.conversations.push(
    { id: "keep-other-user", userId: "u2", courseId: "c1", lessonId: "l1", mode: "lecture", messages: [], updatedAt: timestamp },
    // 2026-10-27：同一 (u1, c1, l1) 下的 socratic 行也会被一起删除，不再是 keep
    { id: "drop-other-mode", userId: "u1", courseId: "c1", lessonId: "l1", mode: "socratic", messages: [], updatedAt: timestamp },
    { id: "keep-other-lesson", userId: "u1", courseId: "c1", lessonId: "l2", mode: "lecture", messages: [], updatedAt: timestamp },
    { id: "drop-one", userId: "u1", courseId: "c1", lessonId: "l1", mode: "lecture", messages: [], updatedAt: timestamp },
    { id: "drop-two", userId: "u1", courseId: "c1", lessonId: "l1", mode: "lecture", messages: [], updatedAt: timestamp },
  );
  await writeProductData(data);

  // 同一 (u1, c1, l1) 下共有 3 行（2 lecture + 1 socratic），全部删除
  assert.equal(await store.deleteConversation("u1", "c1", "l1", "lecture"), 3);
  const after = await store.ensureProductData();
  assert.deepEqual(after.conversations.map((item) => item.id).sort(), ["keep-other-lesson", "keep-other-user"]);
  assert.equal(await store.deleteConversation("u1", "c1", "l1", "lecture"), 0, "a repeated New chat must stay idempotent");
});

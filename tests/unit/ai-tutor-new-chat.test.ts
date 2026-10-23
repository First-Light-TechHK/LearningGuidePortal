import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeProductData } from "./helpers/my-learning";

// New chat (2026-10-22): the server deletes only the signed-in learner's conversation
// for the current course, lesson and mode. Other users, lessons and modes must survive.

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

test("deleteConversation removes only the current learner's course/lesson/mode rows and is idempotent", async () => {
  const timestamp = "2026-10-22T10:00:00.000Z";
  const data = await store.ensureProductData();
  data.conversations.push(
    { id: "keep-other-user", userId: "u2", courseId: "c1", lessonId: "l1", mode: "lecture", messages: [], updatedAt: timestamp },
    { id: "keep-other-mode", userId: "u1", courseId: "c1", lessonId: "l1", mode: "socratic", messages: [], updatedAt: timestamp },
    { id: "keep-other-lesson", userId: "u1", courseId: "c1", lessonId: "l2", mode: "lecture", messages: [], updatedAt: timestamp },
    { id: "drop-one", userId: "u1", courseId: "c1", lessonId: "l1", mode: "lecture", messages: [], updatedAt: timestamp },
    { id: "drop-two", userId: "u1", courseId: "c1", lessonId: "l1", mode: "lecture", messages: [], updatedAt: timestamp },
  );
  await writeProductData(data);

  assert.equal(await store.deleteConversation("u1", "c1", "l1", "lecture"), 2);
  const after = await store.ensureProductData();
  assert.deepEqual(after.conversations.map((item) => item.id).sort(), ["keep-other-lesson", "keep-other-mode", "keep-other-user"]);
  assert.equal(await store.deleteConversation("u1", "c1", "l1", "lecture"), 0, "a repeated New chat must stay idempotent");
});

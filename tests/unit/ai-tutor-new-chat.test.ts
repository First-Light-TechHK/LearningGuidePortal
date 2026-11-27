import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { COURSE_ID, PRIVATE_LP, purchaseCourse, verifiedUser, writeProductData } from "./helpers/my-learning";

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

test("undo removes only the owner's last turn and an older stream cannot restore it", async () => {
  const timestamp = "2026-11-06T10:00:00.000Z";
  const conversation: import("../../services/productStore").ProductConversation = {
    id: "tutor-undo", userId: "undo-owner", courseId: "undo-course", lessonId: "undo-lesson", mode: "lecture", updatedAt: timestamp,
    messages: [{ role: "user", content: "Question", createdAt: timestamp }, { role: "assistant", content: "Answer", createdAt: timestamp }],
  };
  await store.saveConversation(conversation);
  assert.equal(await store.trimLastTutorTurn("other-user", conversation.id, conversation.courseId, "undo-lesson", timestamp), null);
  assert.equal(await store.trimLastTutorTurn(conversation.userId, conversation.id, conversation.courseId, "undo-lesson", "wrong"), null);
  assert.equal((await store.trimLastTutorTurn(conversation.userId, conversation.id, conversation.courseId, "undo-lesson", timestamp))?.question, "Question");
  assert.equal(await store.saveTutorReplyIfUnchanged(conversation, conversation.messages, true), false);
  assert.deepEqual((await store.getConversation(conversation.userId, conversation.id, conversation.courseId, "undo-lesson", "lecture")).messages, []);
});

test("Tutor keeps a legacy turn on interrupted Retry and saves only complete replies", async (t) => {
  const { POST } = await import("../../app/api/ai-tutor/route");
  const owner = await verifiedUser(store, "tutor-stream@example.test");
  await purchaseCourse(store, owner.id);
  const session = await store.createSession(owner.id);
  const course = await store.getProductCourse(COURSE_ID);
  assert.ok(course);
  const createdAt = "2026-11-06T10:00:00.000Z";
  const conversation: import("../../services/productStore").ProductConversation = {
    id: "tutor-stream", userId: owner.id, courseId: course.id, lessonId: PRIVATE_LP, mode: "lecture", updatedAt: createdAt,
    messages: [{ role: "user", content: "Question", createdAt }, { role: "assistant", content: "Old answer", createdAt }],
  };
  await store.saveConversation(conversation);
  const previousUrl = process.env.KS_TUTOR_BASE_URL;
  process.env.KS_TUTOR_BASE_URL = "http://tutor.test";
  t.after(() => {
    if (previousUrl === undefined) delete process.env.KS_TUTOR_BASE_URL;
    else process.env.KS_TUTOR_BASE_URL = previousUrl;
  });

  let complete = false;
  const histories: unknown[][] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === "/api/user/ai-tutors") return Response.json({ data: [{ externalId: course.slug, available: true, online: true }] });
    assert.equal(url.pathname, "/api/user/ai/chat-stream");
    histories.push(JSON.parse(String(init?.body)).history);
    return new Response('data: {"delta":"New answer"}\n\n' + (complete ? 'data: {"done":true}\n\n' : ""));
  });
  const origin = "http://portal.test";
  const send = (body: Record<string, string>) => POST(new Request(origin + "/api/ai-tutor", {
    method: "POST",
    headers: { Origin: origin, Cookie: `learning_guide_session=${session.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ courseId: course.id, lessonId: PRIVATE_LP, conversationId: conversation.id, ...body }),
  }));
  const read = async () => (await store.getConversation(owner.id, conversation.id, course.id, PRIVATE_LP, "lecture")).messages;
  const retry = { action: "retry", lastUserAt: createdAt };

  const interrupted = await send(retry);
  assert.equal(interrupted.status, 200);
  await assert.rejects(interrupted.text(), /stream ended early/);
  assert.deepEqual(await read(), conversation.messages);

  complete = true;
  const response = await send(retry);
  assert.equal(await response.text(), "New answer");
  assert.match(response.headers.get("Content-Type") ?? "", /^text\/plain/);
  const messages = await read();
  assert.equal(messages.length, 2);
  assert.equal(messages[0].createdAt, createdAt);
  assert.ok(messages[0].id);
  assert.equal(messages[1].id, response.headers.get("X-Tutor-Answer-Id"));
  assert.ok(messages[1].id);
  assert.notEqual(messages[0].id, messages[1].id);
  assert.deepEqual(histories, [[], []]);

  const longerHistory = Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 === 0 ? "user" as const : "assistant" as const, content: `Message ${index}`, createdAt,
  }));
  assert.equal(await store.saveTutorReplyIfUnchanged({ ...conversation, messages: longerHistory }, messages, true), true);
  const next = await send({ message: "Next question" });
  assert.equal(await next.text(), "New answer");
  assert.equal(histories[2].length, 10);
  assert.deepEqual(histories[2], longerHistory.slice(-10).map(({ role, content }) => ({ role, content })));
  const saved = await read();
  assert.equal(saved.length, 40);
  assert.deepEqual(saved.slice(0, 38), longerHistory.slice(2));
});

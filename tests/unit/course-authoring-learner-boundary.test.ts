import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const cwd = process.cwd();
const original = { storage: process.env.STORAGE_BACKEND, key: process.env.OPENROUTER_API_KEY, fetch: globalThis.fetch };
let directory: string;
let store: typeof import("../../services/productStore");
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lg-authoring-learner-"));
  process.chdir(directory);
  process.env.STORAGE_BACKEND = "local";
  store = await import("../../services/productStore");
});
after(async () => {
  process.chdir(cwd);
  for (const [name, value] of [["STORAGE_BACKEND", original.storage], ["OPENROUTER_API_KEY", original.key]]) {
    if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
  }
  globalThis.fetch = original.fetch;
  await rm(directory, { recursive: true, force: true });
});

test("public catalogue returns an explicit metadata allowlist, never author or lesson data", async () => {
  const course = await store.createCourseForOperator({ title: "Public catalogue boundary" });
  await store.addLessonToCourse({ courseId: course.id, title: "Private lesson", body: "PRIVATE MATERIAL", durationMinutes: 5 });
  await store.setCourseStatus(course.id, "published");
  const { GET } = await import("../../app/api/portal/courses/route");
  const body = await (await GET()).json();
  const result = body.courses.find((item: { id: string }) => item.id === course.id);
  assert.ok(result);
  assert.deepEqual(Object.keys(result).sort(), ["id", "slug", "title", "description", "category", "thumbnailPath", "status", "createdAt", "updatedAt"].sort());
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE MATERIAL|authorIds|archivedSections|contents/);
});

test("tutor request receives sanitised structured lesson and quiz context", async () => {
  const user = await store.registerUser({ email: "authoring-learner@example.test", password: "password1" });
  const course = await store.createCourseForOperator({ title: "Authored lesson context" });
  const lesson = await store.addLessonToCourse({ courseId: course.id, title: "Causal reasoning", body: "OBSOLETE_LEGACY_BODY", durationMinutes: 5 });
  lesson.contents = [{ id: "content-one", title: "Evidence", type: "text", mode: "interactive", html: "<p>Correlation is not causation.</p><script>PRIVATE_EXECUTABLE</script>", nodes: [{ id: "quiz-one", title: "Reasoning check", type: "exercise", triggerTime: 0, question: "Which explanation follows?", options: ["Common cause", "Necessary cause"], correctOptions: [0] }] }];
  lesson.contents.push({ id: "hidden-group", title: "Hidden", active: false, type: "text", mode: "lecture", html: "<p>INACTIVE_MATERIAL</p>", nodes: [] });
  let payload: { messages: { role: string; content: string }[] } | undefined;
  process.env.OPENROUTER_API_KEY = "test-provider-fixture";
  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(String(init?.body));
    return new Response('data: {"choices":[{"delta":{"content":"Consider the evidence."}}]}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
  };
  const { createTutorResponse } = await import("../../services/productTutor");
  const result = await createTutorResponse({ userId: user.id, course, lesson, mode: "socratic", message: "Help me reason about it", locale: "en-GB" });
  assert.equal(await new Response(result.stream).text(), "Consider the evidence.");
  const context = payload!.messages[0].content;
  for (const expected of ["Correlation is not causation.", "Which explanation follows?", "Common cause", "British English"]) assert.ok(context.includes(expected), expected);
  assert.doesNotMatch(context, /PRIVATE_EXECUTABLE|<script>|INACTIVE_MATERIAL|OBSOLETE_LEGACY_BODY/);
  assert.match(context, /do not claim to have watched, heard or transcribed/);
});

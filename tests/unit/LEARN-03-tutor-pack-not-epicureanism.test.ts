import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Break: AI Tutor knowledge/fallback is hardcoded to Epicureanism (LEARN-03).

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
const originalOpenRouter = process.env.OPENROUTER_API_KEY;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");
let tutor: typeof import("../../services/productTutor");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-learn-03-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  delete process.env.OPENROUTER_API_KEY;
  store = await import("../../services/productStore");
  tutor = await import("../../services/productTutor");
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (originalOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalOpenRouter;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) {
    await rm(isolatedCwd, { recursive: true, force: true });
  }
});

test("LEARN-03: a non-Epicureanism course must not fall back to Epicurus copy", async () => {
  const user = await store.registerUser({
    email: "learn-03-tutor@example.test",
    password: "password1",
    nickname: "Learn Three",
  });
  const created = await store.createCourseForOperator({
    title: "Stoicism Basics",
    description: "Virtue is the sole good.",
    category: "European Humanities",
  });
  const lesson = await store.addLessonToCourse({
    courseId: created.id,
    title: "Virtue",
    body: "Virtue is the sole good. Do not mention other schools.",
    durationMinutes: 10,
    isPublic: true,
  });
  await store.setCourseStatus(created.id, "published");
  const course = await store.getProductCourse(created.id);
  assert.ok(course);

  const result = await tutor.createTutorResponse({
    userId: user.id,
    course,
    lesson,
    mode: "lecture",
    message: "What is the goal of this lesson?",
    locale: "en-GB",
  });
  const answer = await new Response(result.stream).text();
  assert.match(answer, /Virtue|this lesson|course material/i);
  assert.equal(/Epicurus|Epicureanism/i.test(answer), false, `fallback leaked Epicureanism: ${answer.slice(0, 240)}`);
});

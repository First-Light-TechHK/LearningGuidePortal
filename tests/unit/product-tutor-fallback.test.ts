import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// L4 (bug-hunt-2026-10-14): the AI Tutor fallback answer (no OPENROUTER_API_KEY, or a
// provider failure) must follow the requested locale. The system prompt promises
// "Answer in <locale>", so an en-GB conversation must never receive the Chinese
// scaffolding copy and a zh-CN conversation must never receive the English template.

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
const originalOpenRouter = process.env.OPENROUTER_API_KEY;
let isolatedCwd: string;
let tutor: typeof import("../../services/productTutor");

const CJK = new RegExp("[\\u4e00-\\u9fff]");
const ENGLISH_TEMPLATE = /Start with the distinction|this lesson/i;

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-tutor-fallback-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  delete process.env.OPENROUTER_API_KEY;
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

type TutorInput = Parameters<typeof tutor.createTutorResponse>[0];

function course(id: string, title: string) {
  return { id, slug: id, title } as unknown as TutorInput["course"];
}
function lesson(title: string) {
  return { id: "lesson", title } as unknown as TutorInput["lesson"];
}

async function fallbackAnswerFor(locale: "en-GB" | "zh-CN", mode: "lecture" | "socratic", message: string, inputCourse = course("stoicism", "Stoicism Basics")) {
  const result = await tutor.createTutorResponse({
    userId: `fallback-user-${locale}-${mode}`,
    course: inputCourse,
    lesson: lesson("Virtue"),
    mode,
    message,
    locale,
  });
  assert.equal(result.provider, "local-demo", "the fallback path must be exercised");
  return await new Response(result.stream).text();
}

test("en-GB fallback answers are in English in both modes", async () => {
  const lecture = await fallbackAnswerFor("en-GB", "lecture", "What is virtue?");
  assert.doesNotMatch(lecture, CJK, `en-GB lecture fallback leaked Chinese: ${lecture}`);
  const socratic = await fallbackAnswerFor("en-GB", "socratic", "What is virtue?");
  assert.doesNotMatch(socratic, CJK, `en-GB socratic fallback leaked Chinese: ${socratic}`);
});

test("zh-CN fallback answers are in Chinese and never use the English template", async () => {
  const lecture = await fallbackAnswerFor("zh-CN", "lecture", "什么是德性？");
  assert.match(lecture, CJK, `zh-CN lecture fallback is not Chinese: ${lecture}`);
  assert.doesNotMatch(lecture, ENGLISH_TEMPLATE, `zh-CN lecture fallback used the English template: ${lecture}`);
  const socratic = await fallbackAnswerFor("zh-CN", "socratic", "什么是德性？");
  assert.match(socratic, CJK, `zh-CN socratic fallback is not Chinese: ${socratic}`);
});

test("the Epicureanism course copy follows the locale too", async () => {
  const epicureanism = course("epicureanism", "Epicureanism");
  const zhLecture = await fallbackAnswerFor("zh-CN", "lecture", "快乐是什么？", epicureanism);
  assert.match(zhLecture, CJK, `zh-CN Epicureanism lecture fallback is not Chinese: ${zhLecture}`);
  assert.doesNotMatch(zhLecture, ENGLISH_TEMPLATE, `zh-CN Epicureanism lecture fallback used the English template: ${zhLecture}`);
  const zhSocratic = await fallbackAnswerFor("zh-CN", "socratic", "快乐是什么？", epicureanism);
  assert.match(zhSocratic, CJK, `zh-CN Epicureanism socratic fallback is not Chinese: ${zhSocratic}`);
  const enLecture = await fallbackAnswerFor("en-GB", "lecture", "What is pleasure?", epicureanism);
  assert.doesNotMatch(enLecture, CJK, `en-GB Epicureanism lecture fallback leaked Chinese: ${enLecture}`);
  const enSocratic = await fallbackAnswerFor("en-GB", "socratic", "What is pleasure?", epicureanism);
  assert.doesNotMatch(enSocratic, CJK, `en-GB Epicureanism socratic fallback leaked Chinese: ${enSocratic}`);
  const zhOther = await fallbackAnswerFor("zh-CN", "lecture", "正义是什么？", epicureanism);
  assert.match(zhOther, CJK, `zh-CN Epicureanism follow-up fallback is not Chinese: ${zhOther}`);
  const enOther = await fallbackAnswerFor("en-GB", "socratic", "What is justice?", epicureanism);
  assert.doesNotMatch(enOther, CJK, `en-GB Epicureanism follow-up fallback leaked Chinese: ${enOther}`);
});

test("a provider failure falls back to the requested locale as well", async () => {
  process.env.OPENROUTER_API_KEY = "test-provider-fixture";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("provider down"); };
  try {
    const answer = await fallbackAnswerFor("zh-CN", "lecture", "什么是德性？");
    assert.match(answer, CJK, `zh-CN provider-failure fallback is not Chinese: ${answer}`);
  } finally {
    delete process.env.OPENROUTER_API_KEY;
    globalThis.fetch = originalFetch;
  }
});

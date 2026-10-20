import assert from "node:assert/strict";
import { test } from "node:test";
import { clampTutorReply, openRouterTutorCall, parseTutorReply, publishLiveKitData, tutorReplyLimit } from "../../modules/group-study/tutorAnswer";
import { STUDY_GROUP_TUTOR_SYSTEM_PROMPT } from "../../modules/group-study/tutorPrompt";

// The tutor answer contract (owner decision, replaces lexical retrieval and
// the refusal):
// - The model itself fuzzy-matches a question against the whole course
//   material, across languages. The server performs no retrieval and applies
//   no hit threshold, and the tutor never refuses.
// - Every reply starts with a COURSE or GENERAL tag line, parsed off before
//   the text is published; a missing tag defaults to GENERAL so nothing can
//   be presented as course content unverified.
// - The published text is clamped: markdown removed, bullets normalised, at
//   most four lines, and capped at 120 CJK characters or 240 otherwise.

test("a COURSE tag line is parsed off and selects the course mode", () => {
  const parsed = parseTutorReply("COURSE\nEpicurus taught that pleasure is the highest good.\n• Pleasure means the absence of pain.");
  assert.equal(parsed.mode, "course");
  assert.equal(parsed.text, "Epicurus taught that pleasure is the highest good.\n• Pleasure means the absence of pain.");
});

test("a GENERAL tag with a same-line colon is parsed", () => {
  const parsed = parseTutorReply("GENERAL: Caffeine is a stimulant.");
  assert.equal(parsed.mode, "general");
  assert.equal(parsed.text, "Caffeine is a stimulant.");
});

test("a bracketed tag is parsed", () => {
  const parsed = parseTutorReply("[general] Caffeine is a stimulant.");
  assert.equal(parsed.mode, "general");
  assert.equal(parsed.text, "Caffeine is a stimulant.");
});

test("a lower-case course tag is parsed", () => {
  const parsed = parseTutorReply("course\nPleasure is the absence of pain.");
  assert.equal(parsed.mode, "course");
  assert.equal(parsed.text, "Pleasure is the absence of pain.");
});

test("a reply without a tag defaults to general with the full text", () => {
  const parsed = parseTutorReply("Friendship is central to a happy life.");
  assert.equal(parsed.mode, "general");
  assert.equal(parsed.text, "Friendship is central to a happy life.");
});

test("a word that merely starts with the tag is not eaten", () => {
  const parsed = parseTutorReply("Generally speaking, pleasure is the goal.");
  assert.equal(parsed.mode, "general");
  assert.equal(parsed.text, "Generally speaking, pleasure is the goal.");
});

test("a prose reply whose first word is the tag word is not eaten", () => {
  // Harder than "Generally": the first word IS the tag, but the rest of the
  // line is prose — unverified text must default to general, unstripped.
  const parsed = parseTutorReply("Course material explains that pleasure is the goal of the good life.");
  assert.equal(parsed.mode, "general");
  assert.equal(parsed.text, "Course material explains that pleasure is the goal of the good life.");
});

test("a bold-wrapped tag is parsed and never leaks into the text", () => {
  const parsed = parseTutorReply("**COURSE**\nEpicurus taught that pleasure is the highest good.");
  assert.equal(parsed.mode, "course");
  assert.equal(parsed.text, "Epicurus taught that pleasure is the highest good.");
});

test("a bare tag yields an empty text", () => {
  assert.deepEqual(parseTutorReply("COURSE"), { mode: "course", text: "" });
});

// The two reply_format examples from the system prompt, verbatim. The prompt
// promises the model this exact shape, so the parser must accept the examples
// as written; the includes() guards fail if the prompt's examples are edited
// without updating these copies — that is what keeps the prompt and the
// parser (tutorAnswer.ts) in agreement rather than just this file.
const PROMPT_COURSE_EXAMPLE = `COURSE
Epicurus treats death as the end of sensation.
• The soul is mortal and dissolves with the body.
• While we live, death is absent; when death is here, we are not.`;
const PROMPT_COURSE_CLEAN_TEXT = `Epicurus treats death as the end of sensation.
• The soul is mortal and dissolves with the body.
• While we live, death is absent; when death is here, we are not.`;

const PROMPT_GENERAL_EXAMPLE = `GENERAL
Caffeine is a stimulant that blocks adenosine receptors.
• Peak effect comes about 30 minutes after intake.`;
const PROMPT_GENERAL_CLEAN_TEXT = `Caffeine is a stimulant that blocks adenosine receptors.
• Peak effect comes about 30 minutes after intake.`;

test("the system prompt's COURSE example is consistent with the parser: mode course, tag line removed, clamp unchanged", () => {
  assert.equal(STUDY_GROUP_TUTOR_SYSTEM_PROMPT.includes(PROMPT_COURSE_EXAMPLE), true);
  const parsed = parseTutorReply(PROMPT_COURSE_EXAMPLE);
  assert.equal(parsed.mode, "course");
  assert.equal(parsed.text, PROMPT_COURSE_CLEAN_TEXT);
  assert.equal(clampTutorReply(parsed.text), parsed.text);
});

test("the system prompt's GENERAL example is consistent with the parser: mode general, tag line removed, clamp unchanged", () => {
  assert.equal(STUDY_GROUP_TUTOR_SYSTEM_PROMPT.includes(PROMPT_GENERAL_EXAMPLE), true);
  const parsed = parseTutorReply(PROMPT_GENERAL_EXAMPLE);
  assert.equal(parsed.mode, "general");
  assert.equal(parsed.text, PROMPT_GENERAL_CLEAN_TEXT);
  assert.equal(clampTutorReply(parsed.text), parsed.text);
});

test("clamp keeps at most four lines and normalises bullets", () => {
  const raw = "Intro line.\n- first point\n* second point\n• third point\n- fourth point";
  assert.equal(clampTutorReply(raw), "Intro line.\n• first point\n• second point\n• third point");
});

test("clamp strips markdown, headings, and divider lines", () => {
  const raw = "# Heading\n**Bold fact** and `code` and _italic_ text.\n---\nDone.";
  assert.equal(clampTutorReply(raw), "Heading\nBold fact and code and italic text.\nDone.");
});

test("clamp drops empty lines and may return an empty string", () => {
  assert.equal(clampTutorReply("---\n\n"), "");
});

test("clamp caps an English reply at 240 characters on a sentence boundary", () => {
  const sentence = "This is a key point about the course material. "; // 47 characters
  const raw = sentence.repeat(20);
  const clamped = clampTutorReply(raw);
  assert.equal(clamped.length <= 241, true);
  // Cut after the last whole sentence; the ellipsis takes the full stop's place.
  assert.equal(clamped.endsWith("material…"), true);
  assert.equal(clamped.includes(".…"), false);
});

test("clamp caps a Chinese reply at 120 characters on a sentence boundary", () => {
  const sentence = "这是课程材料中的一个要点。"; // 13 characters
  const raw = sentence.repeat(20);
  const clamped = clampTutorReply(raw);
  assert.equal(clamped.length <= 121, true);
  assert.equal(clamped.endsWith("要点…"), true);
  assert.equal(clamped.includes("。…"), false);
});

test("clamp hard-cuts when the only boundary is too early", () => {
  const raw = "Short. " + "x".repeat(400);
  const clamped = clampTutorReply(raw);
  // The only boundary sits at position 5, far before half of the 240 cap.
  assert.equal(clamped, `${raw.slice(0, 240)}…`);
});

test("clamp keeps underscores and asterisks inside words and numbers (QA M22)", () => {
  assert.equal(clampTutorReply("Use x_1 in snake_case_name; 2*3*4 = 24."), "Use x_1 in snake_case_name; 2*3*4 = 24.");
  assert.equal(clampTutorReply("a * b * c and file_name_v2"), "a * b * c and file_name_v2");
  assert.equal(clampTutorReply("**Bold**, *italic*, __strong__ and _em_!"), "Bold, italic, strong and em!");
  assert.equal(clampTutorReply("这是**重点**内容，_斜体_。"), "这是重点内容，斜体。");
});

test("clamp sizes the cap by the share of CJK characters (QA M22)", () => {
  assert.equal(tutorReplyLimit("English only."), 240);
  assert.equal(tutorReplyLimit("全部是中文。"), 120);
  // One Chinese word in an English reply barely moves the cap.
  const mixed = `${"An English answer that names one term ".repeat(5)}伊壁鸠鲁 once.`;
  assert.equal(tutorReplyLimit(mixed) > 230, true);
  assert.equal(clampTutorReply(mixed), mixed);
});

test("a cut reply never ends on doubled punctuation (QA M22)", () => {
  const clause = clampTutorReply("这是一个很长的句子，".repeat(20));
  assert.equal(clause.endsWith("句子…"), true);
  assert.equal(/[，。,.]…$/.test(clause), false);
  const english = clampTutorReply("one clause, ".repeat(40));
  assert.equal(english.endsWith("clause…"), true);
});

test("clamp keeps a reply exactly at the cap and truncates one past it", () => {
  const exact = "字".repeat(120);
  assert.equal(clampTutorReply(exact), exact);
  assert.equal(clampTutorReply("字".repeat(121)), `${"字".repeat(120)}…`);
});

test("the tutor call sends the whole course material under the course_material label", async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body ?? "") });
    return new Response(JSON.stringify({ choices: [{ message: { content: "COURSE\nThe answer." } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await openRouterTutorCall({
      secret: "fake-key",
      model: "test-model",
      system: "system prompt",
      context: "FULL COURSE MATERIAL",
      text: "What is pleasure?",
      url: "http://127.0.0.1:8788/v1/chat/completions"
    });
    assert.equal(result.outcome, "ok");
    assert.equal(result.body, "COURSE\nThe answer.");
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].body) as { max_tokens: number; messages: Array<{ role: string; content: string }> };
  assert.equal(body.max_tokens, 700);
  // The body never sets `reasoning`: the shared OpenRouter layer supplies the
  // CoT policy (reasoning off, excluded, retried without it on 400), and an
  // explicit field here would disable that fallback.
  assert.equal((body as Record<string, unknown>).reasoning, undefined);
  assert.equal(body.messages[1].content.includes("<course_material>\nFULL COURSE MATERIAL\n</course_material>"), true);
  assert.equal(body.messages[1].content.includes("<participant_text>\nWhat is pleasure?\n</participant_text>"), true);
  assert.equal(body.messages[1].content.includes("following the reply format exactly."), true);
});

test("the OpenRouter path runs with the shared CoT defaults: reasoning off and excluded", async () => {
  const calls: Array<{ body: string }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ body: String(init?.body ?? "") });
    return new Response(JSON.stringify({ choices: [{ message: { content: "COURSE\nThe answer." } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await openRouterTutorCall({
      secret: "fake-key",
      model: "test-model",
      system: "system prompt",
      context: "FULL COURSE MATERIAL",
      text: "What is pleasure?"
    });
    assert.equal(result.outcome, "ok");
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].body) as { max_tokens: number; reasoning?: { effort?: string; exclude?: boolean } };
  assert.equal(body.max_tokens, 700);
  assert.deepEqual(body.reasoning, { effort: "none", exclude: true });
});

test("the call accepts centralised model settings: a token budget and an explicit reasoning effort", async () => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(init?.body ?? ""));
    return new Response(JSON.stringify({ choices: [{ message: { content: "COURSE\nThe answer." } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await openRouterTutorCall({
      secret: "fake-key",
      model: "test-model",
      system: "system prompt",
      context: "material",
      text: "q",
      maxTokens: 1200,
      reasoning: { effort: "low" }
    });
    assert.equal(result.outcome, "ok");
  } finally {
    globalThis.fetch = original;
  }
  const body = JSON.parse(calls[0]) as { max_tokens: number; reasoning?: { effort?: string } };
  assert.equal(body.max_tokens, 1200);
  assert.deepEqual(body.reasoning, { effort: "low" });
});

test("the LiveKit data message carries the reply mode", async () => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(init?.body ?? ""));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await publishLiveKitData({
      url: "wss://livekit.example.test",
      apiKey: "lk-key",
      apiSecret: "lk-secret-at-least-32-characters",
      room: "room-1",
      text: "",
      mode: "unavailable",
      now: new Date("2026-09-19T02:00:00.000Z")
    });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0]) as { data: string };
  const decoded = JSON.parse(Buffer.from(body.data, "base64").toString("utf8")) as { type: string; text: string; mode: string };
  assert.deepEqual(decoded, { type: "tutor", text: "", mode: "unavailable" });
});

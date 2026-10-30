// v7 (2026-10-30): the chat's Thinking card. Admin streams its workflow steps (Accept: text/event-stream; only the
// step names, never model text) and Portal passes them on to the browser the same way. These lock the parser, the
// Admin client's streamed suggest call and its fallbacks, and Portal's own event-stream response.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { ASSISTANT_STEPS, createEventStreamParser, isAssistantStep } from "../../contracts/helpdesk";
import { createAdminHelpdeskClient } from "../../modules/helpdesk/adminClient";
import { eventStreamResponse, wantsEventStream } from "../../modules/helpdesk/http";
import { HelpdeskProblem } from "../../contracts/helpdesk";

const BASE = "http://admin.local:3100";
const env = { ...process.env };
const SUGGESTION = { id: "0192d4f0-7b6a-7c3e-9a10-0000000000aa", faqId: "0192d4f0-7b6a-7c3e-9a10-1234567890ab", question: "How do I reset my password?", answer: "Open **Sign in**, then Forgot password." };
const INPUT = { learnerId: "u1", locale: "en-GB" as const, source: "chat" as const, message: "reset password", runId: "0192d4f0-7b6a-7c3e-9a10-0000000000b2", parentRunId: null };

beforeEach(() => {
  process.env.ADMIN_HELPDESK_BASE_URL = BASE;
  process.env.ADMIN_HELPDESK_TOKEN = "local-test-admin-helpdesk-token";
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
});

/** A text/event-stream body that sends each chunk in its own read. */
function sse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); }
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

test("the step names match Admin's workflow, and only those count", () => {
  assert.deepEqual([...ASSISTANT_STEPS], ["retrieve", "pick", "explain", "route", "smalltalk", "ground"]);
  assert.equal(isAssistantStep("pick"), true);
  assert.equal(isAssistantStep("thinking"), false);
  assert.equal(isAssistantStep(null), false);
});

test("the event-stream parser: events split anywhere across chunks, CRLF and LF, comments, multi-line data", () => {
  const parser = createEventStreamParser();
  const text = ': keep-alive\r\nevent: step\r\ndata: {"step":"retrieve"}\r\n\r\nevent: step\ndata: {"step":"pick"}\n\nevent: result\ndata: {"a":1,\ndata: "b":2}\n\n';
  const seen = [];
  for (let i = 0; i < text.length; i += 3) seen.push(...parser.push(text.slice(i, i + 3)));
  assert.deepEqual(seen, [
    { event: "step", data: '{"step":"retrieve"}' },
    { event: "step", data: '{"step":"pick"}' },
    { event: "result", data: '{"a":1,\n"b":2}' }
  ]);
  // a lone \r at the end of a chunk is held until the next one says whether \n follows
  const split = createEventStreamParser();
  assert.deepEqual(split.push("event: step\r\ndata: {}\r"), []);
  assert.deepEqual(split.push("\n\r\n"), [{ event: "step", data: "{}" }]);
});

test("Admin client: with onStep the suggest call asks for the stream and passes each step on, in order, before the answer", async () => {
  const seen: string[] = [];
  let accept = "";
  const fetch = (async (_url: string, init: RequestInit) => {
    accept = new Headers(init.headers).get("accept") ?? "";
    return sse(['event: step\ndata: {"step":"retrieve"}\n\n', 'event: st', 'ep\ndata: {"step":"pick"}\n\nevent: step\ndata: {"step":"made_up"}\n\n', `event: result\ndata: ${JSON.stringify({ suggestion: SUGGESTION, alternatives: [] })}\n\n`]);
  }) as typeof globalThis.fetch;
  const reply = await createAdminHelpdeskClient({ fetch }).suggestReply(INPUT, { onStep: (step) => seen.push(step) });
  assert.match(accept, /text\/event-stream/);
  assert.deepEqual(seen, ["retrieve", "pick"], "an unknown step name is ignored");
  assert.deepEqual(reply, { suggestion: SUGGESTION, alternatives: [] }, "the result event is read like the plain JSON answer");
});

test("Admin client: an error event, a cut stream and an older Admin's plain JSON all read safely", async () => {
  const logs: Array<Record<string, unknown>> = [];
  const read = (response: () => Response) => createAdminHelpdeskClient({ fetch: (async () => response()) as typeof globalThis.fetch, log: (line) => logs.push(line) }).suggestReply(INPUT, { onStep: () => undefined });
  assert.deepEqual(await read(() => sse(['event: step\ndata: {"step":"retrieve"}\n\n', 'event: error\ndata: {"status":400,"code":"validation_failed"}\n\n'])), { suggestion: null, alternatives: [] });
  assert.equal(logs.at(-1)?.reason, "Error");
  assert.deepEqual(await read(() => sse(['event: step\ndata: {"step":"retrieve"}\n\n'])), { suggestion: null, alternatives: [] }, "the stream ended without a result");
  assert.deepEqual(await read(() => new Response(JSON.stringify({ suggestion: SUGGESTION, alternatives: [] }), { status: 200, headers: { "content-type": "application/json" } })), { suggestion: SUGGESTION, alternatives: [] }, "an Admin that does not stream");
});

test("Admin client: without onStep nothing changes (Accept: application/json only)", async () => {
  let accept = "";
  const fetch = (async (_url: string, init: RequestInit) => {
    accept = new Headers(init.headers).get("accept") ?? "";
    return new Response(JSON.stringify({ suggestion: SUGGESTION, alternatives: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  assert.deepEqual(await createAdminHelpdeskClient({ fetch }).suggestReply(INPUT), { suggestion: SUGGESTION, alternatives: [] });
  assert.equal(accept, "application/json");
});

test("Portal's event-stream response: steps, then result; a thrown problem is an error event with its status; never buffered", async () => {
  assert.equal(wantsEventStream(new Request("http://x", { headers: { accept: "text/event-stream, application/json" } })), true);
  assert.equal(wantsEventStream(new Request("http://x")), false);
  const ok = eventStreamResponse(async (send) => { send("step", { step: "retrieve" }); send("step", { step: "pick" }); return { id: "a1", reply: null, alternatives: [] }; }, "test");
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("content-type") ?? "", /^text\/event-stream/);
  assert.match(ok.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(ok.headers.get("x-accel-buffering"), "no");
  assert.equal(await ok.text(), 'event: step\ndata: {"step":"retrieve"}\n\nevent: step\ndata: {"step":"pick"}\n\nevent: result\ndata: {"id":"a1","reply":null,"alternatives":[]}\n\n');
  const limited = eventStreamResponse(async () => { throw new HelpdeskProblem("rate_limited", "Too many questions.", { retryAfter: 60 }); }, "test");
  const [event] = createEventStreamParser().push(await limited.text());
  assert.equal(event.event, "error");
  const problem = JSON.parse(event.data);
  assert.equal(problem.status, 429);
  assert.equal(problem.code, "rate_limited");
  assert.equal(problem.retryAfter, 60);
});

test("the browser code takes the stream helpers from the client-safe module, never values from contracts/helpdesk (it pulls in node:crypto)", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  assert.doesNotMatch(readFileSync("contracts/helpdeskStream.ts", "utf8"), /^import /m, "no imports at all");
  for (const file of readdirSync("components/helpdesk").filter((name) => /\.tsx?$/.test(name))) {
    const source = readFileSync(`components/helpdesk/${file}`, "utf8");
    for (const line of source.match(/^import [^;]*from "@\/contracts\/helpdesk";/gm) ?? []) assert.match(line, /^import type /, `${file}: ${line}`);
  }
});

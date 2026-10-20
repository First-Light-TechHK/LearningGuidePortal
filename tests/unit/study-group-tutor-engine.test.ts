import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { openRouterTutorCall, replyMatchesQuestionLanguage } from "../../modules/group-study/tutorAnswer";
import { TUTOR_CALL_MS, answerTutorQuestion, type TutorEngineCall } from "../../modules/group-study/tutorEngine";
import { createTutorHealth, TUTOR_CIRCUIT_PAUSE_MS } from "../../modules/group-study/tutorHealth";
import { createTutorKeyPool, type TutorCallResult } from "../../modules/group-study/tutorKeyPool";
import { openTutorQuiz, renderRoomContext, roomTutorTools, type TutorExchange } from "../../modules/group-study/tutorTools";
import { DEFAULT_TUTOR_MODELS, tutorDailyBudgetFromEnv, tutorModelsFromEnv } from "../../modules/group-study/runtime";

// Tutor infra 2026-10-20: the answer engine between the durable queue and one
// provider request — model fallback, key pool, retries inside the deadline,
// the tool loop, the reply checks — and the per-process health that decides
// whether the room offers the Tutor.

const KEYS = [{ id: "a", secret: "secret-key-a-0123456789" }, { id: "b", secret: "secret-key-b-0123456789" }];

type Seen = { model: string; secret: string; tools: string[]; toolChoice?: "none"; turns: number; roomContext: string };

function engine(input: { call: (seen: Seen) => TutorCallResult | Promise<TutorCallResult>; models?: string[]; keys?: typeof KEYS; question?: string; context?: string; deadlineMs?: number; health?: ReturnType<typeof createTutorHealth>; tools?: ReturnType<typeof roomTutorTools>; refreshKeys?: () => Promise<typeof KEYS> }) {
  const seen: Seen[] = [];
  const health = input.health ?? createTutorHealth();
  const call: TutorEngineCall = async (args) => {
    const record = { model: args.model, secret: args.secret, tools: (args.tools ?? []).map((tool) => tool.name), ...(args.toolChoice ? { toolChoice: args.toolChoice } : {}), turns: args.turns.length, roomContext: args.roomContext };
    seen.push(record);
    return input.call(record);
  };
  const pools = new Map<string, ReturnType<typeof createTutorKeyPool>>();
  const result = answerTutorQuestion({
    question: input.question ?? "Why should we not fear death?",
    context: input.context ?? "Epicurus: death is nothing to us.",
    roomContext: "",
    keys: input.keys ?? KEYS,
    models: input.models ?? ["primary", "backup"],
    pool: (keys) => {
      const key = JSON.stringify(keys);
      if (!pools.has(key)) pools.set(key, createTutorKeyPool({ keys, call: async () => ({ outcome: "failed", latencyMs: 0 }) }));
      return pools.get(key)!;
    },
    call,
    tools: input.tools,
    health,
    deadline: Date.now() + (input.deadlineMs ?? 10_000),
    refreshKeys: input.refreshKeys,
    sleep: async () => undefined
  });
  return { result, seen, health };
}

const ANSWER = "COURSE\nDeath is the end of sensation, so it is nothing to us.";

test("a retired model is skipped: the next model answers, and later questions go straight to it", async () => {
  const health = createTutorHealth();
  const first = engine({ health, call: ({ model }) => model === "primary" ? { outcome: "model_gone", latencyMs: 1 } : { outcome: "ok", latencyMs: 1, body: ANSWER, model: "backup" } });
  const answered = await first.result;
  assert.equal(answered.status, "answered");
  assert.equal(answered.status === "answered" && answered.model, "backup");
  // One call for the gone model (the pool stops: no key would fare better).
  assert.deepEqual(first.seen.map((item) => item.model), ["primary", "backup"]);
  assert.deepEqual(health.snapshot().goneModels, ["primary"]);
  const second = engine({ health, call: () => ({ outcome: "ok", latencyMs: 1, body: ANSWER }) });
  await second.result;
  assert.deepEqual(second.seen.map((item) => item.model), ["backup"]);
});

test("a transient provider failure is retried inside the deadline, across keys and models", async () => {
  let failures = 3;
  const { result, seen } = engine({ call: () => failures-- > 0 ? { outcome: "upstream_error", latencyMs: 1 } : { outcome: "ok", latencyMs: 1, body: ANSWER } });
  const answered = await result;
  assert.equal(answered.status, "answered");
  // key a and key b of the primary fail, key a of the backup fails, key b answers.
  assert.deepEqual(seen.map((item) => `${item.model}:${item.secret.slice(11, 12)}`), ["primary:a", "primary:b", "backup:a", "backup:b"]);
  assert.equal(answered.attempts, 4);
});

test("every key refused ends the question at once: no retry rounds, the reason says auth", async () => {
  const { result, seen } = engine({ call: () => ({ outcome: "auth_failed", latencyMs: 1 }) });
  const failed = await result;
  assert.deepEqual([failed.status, failed.status === "failed" && failed.reason], ["failed", "auth"]);
  assert.equal(seen.length, 2, "one call per key, then stop");
});

test("a key pool rotated while every key was refused gets one more try with the new keys", async () => {
  const rotated = [{ id: "c", secret: "secret-key-c-0123456789" }];
  const { result, seen } = engine({
    call: ({ secret }) => secret === rotated[0].secret ? { outcome: "ok", latencyMs: 1, body: ANSWER } : { outcome: "auth_failed", latencyMs: 1 },
    refreshKeys: async () => rotated
  });
  assert.equal((await result).status, "answered");
  assert.equal(seen.at(-1)?.secret, rotated[0].secret);
});

test("no key configured fails as no_key without calling anything", async () => {
  const { result, seen } = engine({ keys: [], call: () => ({ outcome: "ok", latencyMs: 1, body: ANSWER }) });
  const failed = await result;
  assert.deepEqual([failed.status, failed.status === "failed" && failed.reason], ["failed", "no_key"]);
  assert.equal(seen.length, 0);
});

test("the deadline bounds retries: a slow failing provider ends with its last failure class", async () => {
  const { result, seen } = engine({
    deadlineMs: 120,
    call: async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { outcome: "timeout", latencyMs: 50 };
    }
  });
  const failed = await result;
  assert.deepEqual([failed.status, failed.status === "failed" && failed.reason], ["failed", "timeout"]);
  assert.ok(seen.length >= 1 && seen.length <= 3, `calls stay inside the deadline (${seen.length})`);
});

test("a reply in the wrong language goes to the next model; if none does better it is still delivered", async () => {
  const chinese = engine({
    question: "伊壁鸠鲁为什么说不必害怕死亡？",
    call: ({ model }) => ({ outcome: "ok", latencyMs: 1, body: model === "primary" ? ANSWER : "COURSE\n因为死亡意味着感觉的终结。" })
  });
  const answered = await chinese.result;
  assert.equal(answered.status === "answered" && answered.text, "因为死亡意味着感觉的终结。");
  assert.deepEqual(chinese.seen.map((item) => item.model), ["primary", "backup"]);

  const stubborn = engine({ question: "伊壁鸠鲁为什么说不必害怕死亡？", call: () => ({ outcome: "ok", latencyMs: 1, body: ANSWER }) });
  const delivered = await stubborn.result;
  assert.equal(delivered.status, "answered", "an answer in the wrong language beats no answer");
  assert.equal(stubborn.seen.length, 2, "each model once, no extra rounds");
  assert.equal(replyMatchesQuestionLanguage("What is ataraxia?", "Ataraxia means 心神安宁, freedom from disturbance."), true);
});

test("the tool loop: a tool call is answered from the room's records and the model then replies", async () => {
  const history: TutorExchange[] = [
    { question: "Quiz us on Epicurus", answer: "Why should we not fear death?", kind: "quiz", mode: "course", answeredAt: new Date(Date.now() - 60_000).toISOString() }
  ];
  const tools = roomTutorTools({ history, nowMs: Date.now() });
  let step = 0;
  const { result, seen } = engine({
    tools,
    call: () => step++ === 0
      ? { outcome: "ok", latencyMs: 1, body: "", toolCalls: [{ id: "call-1", name: "get_open_quiz", arguments: "{}" }] }
      : { outcome: "ok", latencyMs: 1, body: "COURSE\nRight: death is the end of sensation." }
  });
  const answered = await result;
  assert.equal(answered.status === "answered" && answered.toolCalls, 1);
  assert.deepEqual(seen.map((item) => [item.tools, item.turns]), [[["get_room_history", "get_open_quiz"], 0], [["get_room_history", "get_open_quiz"], 2]]);
  assert.equal(JSON.parse(await tools.run({ id: "x", name: "get_open_quiz", arguments: "{}" })).question, "Why should we not fear death?");
  assert.match(await tools.run({ id: "x", name: "get_room_history", arguments: "not json" }), /error/);
  assert.match(await tools.run({ id: "x", name: "delete_everything", arguments: "{}" }), /unknown tool/);
});

test("the tool loop is bounded: the last step forbids another tool call, so the model must answer", async () => {
  const tools = roomTutorTools({ history: [], nowMs: Date.now() });
  const { result, seen } = engine({
    tools,
    call: ({ toolChoice }) => toolChoice !== "none"
      ? { outcome: "ok", latencyMs: 1, body: "", toolCalls: Array.from({ length: 5 }, (_, index) => ({ id: `c${index}`, name: "get_room_history", arguments: "{\"limit\":3}" })) }
      : { outcome: "ok", latencyMs: 1, body: ANSWER }
  });
  const answered = await result;
  assert.equal(answered.status, "answered");
  // Tool definitions stay on every call of the loop (providers reject tool
  // history without them); the third call forbids tools.
  assert.deepEqual(seen.map((item) => [item.tools.length > 0, item.toolChoice ?? null]), [[true, null], [true, null], [true, "none"]]);
  assert.equal(answered.status === "answered" && answered.toolCalls, 6, "at most three tool calls run per step");
});

test("a model that refuses tool definitions is asked again without them, and remembered", async () => {
  const tools = roomTutorTools({ history: [], nowMs: Date.now() });
  const health = createTutorHealth();
  const { result, seen } = engine({ tools, health, models: ["plain"], call: ({ tools: offered }) => offered.length ? { outcome: "tools_unsupported", latencyMs: 1 } : { outcome: "ok", latencyMs: 1, body: ANSWER } });
  assert.equal((await result).status, "answered");
  assert.deepEqual(seen.map((item) => item.tools.length), [2, 0]);
  assert.deepEqual(health.snapshot().noToolModels, ["plain"]);
});

test("a reply echoing any key of the pool is never delivered", async () => {
  const { result } = engine({ models: ["only"], call: () => ({ outcome: "ok", latencyMs: 1, body: `COURSE\nThe key is ${KEYS[1].secret}` }) });
  const failed = await result;
  assert.deepEqual([failed.status, failed.status === "failed" && failed.reason], ["failed", "malformed"]);
});

test("room context: the latest exchanges and the open understanding check, as untrusted room data", () => {
  const now = Date.parse("2026-10-20T10:00:00.000Z");
  const at = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const history: TutorExchange[] = [
    { question: "q1", answer: "a1", kind: "answer", mode: "course", answeredAt: at(30) },
    { question: "q2", answer: "a2", kind: "answer", mode: "general", answeredAt: at(20) },
    { question: "q3", answer: "a3", kind: "answer", mode: "course", answeredAt: at(10) },
    { question: "Quiz us", answer: "Why not fear death?", kind: "quiz", mode: "course", answeredAt: at(2) }
  ];
  const rendered = renderRoomContext(history, now);
  assert.equal(rendered.includes("q1"), false, "only the latest three inline");
  assert.match(rendered, /Open understanding check \(asked 2 min ago\): Why not fear death\?/);
  assert.match(rendered, /1 earlier exchange\(s\) are available through get_room_history/);
  assert.equal(openTutorQuiz(history, now + 20 * 60_000), null, "an old quiz is closed");
  assert.equal(renderRoomContext([], now), "");
});

test("health: three failures in a row pause the Tutor for a minute; budget and keys gate it too", () => {
  let now = 1_000_000;
  const health = createTutorHealth({ now: () => now });
  const open = { keysConfigured: true, dailyBudgetUsd: 1 };
  assert.deepEqual(health.availability(open), { available: true });
  for (let index = 0; index < 3; index += 1) health.record({ ok: false, reason: "upstream_error", latencyMs: 10, attempts: 2 });
  assert.deepEqual(health.availability(open), { available: false, reason: "provider_down" });
  now += TUTOR_CIRCUIT_PAUSE_MS;
  assert.deepEqual(health.availability(open), { available: true }, "after the pause the next question probes again");
  health.record({ ok: true, model: "backup", latencyMs: 900, attempts: 1 });
  assert.equal(health.snapshot().consecutiveFailures, 0);
  health.addSpend(0.6);
  health.addSpend(0.5);
  assert.deepEqual(health.availability(open), { available: false, reason: "budget" });
  assert.deepEqual(health.availability({ keysConfigured: false, dailyBudgetUsd: null }), { available: false, reason: "no_key" });
  const snapshot = health.snapshot();
  assert.deepEqual([snapshot.answered, snapshot.failed, snapshot.failureReasons, snapshot.answeredByModel, snapshot.p95LatencyMs], [1, 3, { upstream_error: 3 }, { backup: 1 }, 900]);
  assert.equal(snapshot.spendTodayUsd, 1.1);
  // The spend resets with the UTC day.
  now += 24 * 60 * 60_000;
  assert.equal(health.spendTodayUsd(), 0);
});

test("model and budget settings: a pinned tested pair by default, env lists override", () => {
  assert.deepEqual(tutorModelsFromEnv({}), DEFAULT_TUTOR_MODELS);
  assert.equal(tutorModelsFromEnv({}).includes("openrouter/auto"), false);
  assert.deepEqual(tutorModelsFromEnv({ STUDY_GROUP_TUTOR_MODEL: "x/one" }), ["x/one"]);
  assert.deepEqual(tutorModelsFromEnv({ STUDY_GROUP_TUTOR_MODELS: " x/one, y/two ,x/one,", STUDY_GROUP_TUTOR_MODEL: "z" }), ["x/one", "y/two"]);
  assert.equal(tutorDailyBudgetFromEnv({}), 10);
  assert.equal(tutorDailyBudgetFromEnv({ STUDY_GROUP_TUTOR_DAILY_BUDGET_USD: "2.5" }), 2.5);
  assert.equal(tutorDailyBudgetFromEnv({ STUDY_GROUP_TUTOR_DAILY_BUDGET_USD: "off" }), null);
  assert.equal(tutorDailyBudgetFromEnv({ STUDY_GROUP_TUTOR_DAILY_BUDGET_USD: "nonsense" }), 10);
});

async function withProvider(handler: (body: Record<string, unknown>) => { status: number; json?: unknown; text?: string; delayMs?: number }, run: (url: string, bodies: Array<Record<string, unknown>>) => Promise<void>) {
  const bodies: Array<Record<string, unknown>> = [];
  const server: Server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      bodies.push(body);
      const reply = handler(body);
      setTimeout(() => {
        response.writeHead(reply.status, { "content-type": "application/json" });
        response.end(reply.text ?? JSON.stringify(reply.json ?? {}));
      }, reply.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  try {
    await run(`http://127.0.0.1:${address.port}/v1/chat/completions`, bodies);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const providerInput = (url: string) => ({ secret: "provider-secret-0123456789", model: "m/one", system: "sys", context: "material", text: "question", url });

test("provider outcomes are classified so the engine can act on them", async () => {
  const cases: Array<[number, unknown, string]> = [
    [404, { error: { message: "No endpoints found for m/one." } }, "model_gone"],
    [400, { error: { message: "m/one is not a valid model ID" } }, "model_gone"],
    [500, { error: { message: "boom" } }, "upstream_error"],
    [504, { error: { message: "gateway timeout" } }, "timeout"],
    [400, { error: { message: "context length exceeded" } }, "bad_request"],
    [401, {}, "auth_failed"],
    [429, {}, "rate_limited"],
    [402, {}, "quota"],
    [200, { choices: [{ message: { content: "" } }] }, "empty"]
  ];
  for (const [status, json, outcome] of cases) {
    await withProvider(() => ({ status, json }), async (url) => {
      assert.equal((await openRouterTutorCall(providerInput(url))).outcome, outcome, `${status} ${JSON.stringify(json)}`);
    });
  }
  await withProvider(() => ({ status: 200, text: "not json" }), async (url) => {
    assert.equal((await openRouterTutorCall(providerInput(url))).outcome, "malformed");
  });
  await withProvider(() => ({ status: 200, json: { choices: [] }, delayMs: 300 }), async (url) => {
    assert.equal((await openRouterTutorCall({ ...providerInput(url), timeoutMs: 50 })).outcome, "timeout");
  });
});

test("provider: tools, tool turns and room context go out; tool calls, usage and the served model come back", async () => {
  await withProvider((body) => {
    const messages = body.messages as Array<Record<string, unknown>>;
    if (body.tools && messages.length === 2) return { status: 200, json: { model: "m/one-2026", usage: { prompt_tokens: 120, completion_tokens: 9, cost: 0.0002 }, choices: [{ message: { content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "get_open_quiz", arguments: "{}" } }] } }] } };
    return { status: 200, json: { choices: [{ message: { content: "COURSE\nRight." } }] } };
  }, async (url, bodies) => {
    const tools = roomTutorTools({ history: [], nowMs: Date.now() }).specs;
    const first = await openRouterTutorCall({ ...providerInput(url), roomContext: "[2 min ago] Participant asked: q", tools });
    assert.equal(first.outcome, "ok");
    assert.deepEqual(first.toolCalls, [{ id: "call-1", name: "get_open_quiz", arguments: "{}" }]);
    assert.deepEqual(first.usage, { promptTokens: 120, completionTokens: 9, costUsd: 0.0002 });
    assert.equal(first.model, "m/one-2026");
    const user = (bodies[0].messages as Array<{ content: string }>)[1].content;
    assert.match(user, /<room_context>\n\[2 min ago\] Participant asked: q\n<\/room_context>/);
    assert.deepEqual((bodies[0].tools as Array<{ function: { name: string } }>).map((tool) => tool.function.name), ["get_room_history", "get_open_quiz"]);
    const second = await openRouterTutorCall({ ...providerInput(url), tools, turns: [{ role: "assistant", content: "", toolCalls: first.toolCalls! }, { role: "tool", toolCallId: "call-1", content: "{\"open\":false}" }] });
    assert.equal(second.body, "COURSE\nRight.");
    const sent = bodies[1].messages as Array<Record<string, unknown>>;
    assert.equal(sent[2].role, "assistant");
    assert.equal(sent[3].role, "tool");
    assert.equal(sent[3].tool_call_id, "call-1");
  });
  await withProvider(() => ({ status: 400, json: { error: { message: "This model does not support tool use" } } }), async (url) => {
    const tools = roomTutorTools({ history: [], nowMs: Date.now() }).specs;
    assert.equal((await openRouterTutorCall({ ...providerInput(url), tools })).outcome, "tools_unsupported");
  });
});

test("a rate limit on one model rests the key for that model only: the next model answers with the same key", async () => {
  const { result, seen } = engine({
    keys: [KEYS[0]],
    models: ["busy/model", "free/model"],
    call: ({ model }) => model === "busy/model" ? { outcome: "rate_limited", latencyMs: 1 } : { outcome: "ok", latencyMs: 1, body: ANSWER }
  });
  assert.equal((await result).status, "answered");
  assert.deepEqual(seen.map((item) => [item.model, item.secret]), [["busy/model", KEYS[0].secret], ["free/model", KEYS[0].secret]]);
});

test("a stalled model gets one bounded call, leaving time for the next model", async () => {
  let clock = 0;
  const pool = createTutorKeyPool({ keys: [KEYS[0]], call: async () => ({ outcome: "failed", latencyMs: 0 }), now: () => clock });
  const timeouts: number[] = [];
  const answer = await answerTutorQuestion({
    question: "Why?",
    context: "",
    roomContext: "",
    keys: [KEYS[0]],
    models: ["slow/model", "fast/model"],
    pool: () => pool,
    call: async ({ model, timeoutMs }) => {
      timeouts.push(timeoutMs ?? 0);
      if (model === "slow/model") {
        clock += timeoutMs ?? 0;
        return { outcome: "timeout", latencyMs: timeoutMs ?? 0 };
      }
      return { outcome: "ok", latencyMs: 1, body: ANSWER };
    },
    health: createTutorHealth({ now: () => clock }),
    deadline: 45_000,
    now: () => clock,
    sleep: async (ms) => { clock += ms; }
  });
  assert.equal(answer.status, "answered");
  assert.equal(timeouts[0], TUTOR_CALL_MS, "the first call is capped below the 45 s deadline");
});

test("a model that refused the request is not asked the same request again in a later round", async () => {
  const { result, seen } = engine({ models: ["strict/model"], call: () => ({ outcome: "bad_request", latencyMs: 1 }) });
  const failed = await result;
  assert.deepEqual([failed.status, failed.status === "failed" && failed.reason], ["failed", "bad_request"]);
  assert.equal(seen.length, 1);
});

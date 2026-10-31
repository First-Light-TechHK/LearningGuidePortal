import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  ADMIN_FAQS_CACHE_ENTRIES,
  ADMIN_FAQS_RETRY_MS,
  ADMIN_FAQS_TTL_MS,
  ADMIN_FAQS_WAIT_MS,
  ADMIN_SEARCHES_PER_MINUTE,
  ADMIN_SUGGEST_TIMEOUT_MS,
  clearFaqCache,
  faqCacheSizes,
  createAdminHelpdeskClient
} from "../../modules/helpdesk/adminClient";

const BASE = "http://admin.local:3100";
const TOKEN = "local-test-admin-helpdesk-token";
const env = { ...process.env };
const QUESTION = { id: "0192d4f0-7b6a-7c3e-9a10-1234567890ab", category: "account_technical", popular: true, question: "How do I reset my password?", answer: "Open **Sign in**, then Forgot password.", updatedAt: "2026-10-28T08:30:00.000Z" };
const SUGGESTION = { id: "0192d4f0-7b6a-7c3e-9a10-0000000000aa", faqId: QUESTION.id, question: QUESTION.question, answer: QUESTION.answer };
const POPULAR = { popular: true, limit: 3 };
const RUN_ID = "0192d4f0-7b6a-7c3e-9a10-0000000000b2";
const ROOT_ID = "0192d4f0-7b6a-7c3e-9a10-0000000000b1";

type Call = { url: string; method: string; headers: Headers; body: string | null };

function stubFetch(handler: (call: Call, signal: AbortSignal | undefined) => Promise<Response> | Response) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: String(input), method: init.method || "GET", headers: new Headers(init.headers), body: typeof init.body === "string" ? init.body : null };
    calls.push(call);
    return handler(call, init.signal ?? undefined);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const logs: Array<Record<string, unknown>> = [];

beforeEach(() => {
  process.env.ADMIN_HELPDESK_BASE_URL = `${BASE}/`;
  process.env.ADMIN_HELPDESK_TOKEN = TOKEN;
  clearFaqCache();
  logs.length = 0;
});

afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
});

test("timeouts and cache lifetime match the addendum", () => {
  assert.equal(ADMIN_FAQS_TTL_MS, 60_000);
  assert.equal(ADMIN_SUGGEST_TIMEOUT_MS, 4_000);
});

test("FAQs: Bearer token, locale + popular + limit query, cached for 60 s, then revalidated with If-None-Match", async () => {
  let clock = 1_000_000;
  const stub = stubFetch((call) => call.headers.get("if-none-match") === '"v1"' ? new Response(null, { status: 304, headers: { etag: '"v1"' } }) : json({ faqs: [QUESTION], etag: '"v1"' }, 200, { etag: '"v1"' }));
  const client = createAdminHelpdeskClient({ fetch: stub.fetch, now: () => clock, log: (line) => logs.push(line) });
  assert.deepEqual(await client.faqs("en-GB", POPULAR), [QUESTION]);
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0].url, `${BASE}/api/integration/helpdesk/faqs?locale=en-GB&popular=true&limit=3`);
  assert.equal(stub.calls[0].headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.equal(stub.calls[0].headers.get("if-none-match"), null);
  clock += ADMIN_FAQS_TTL_MS - 1;
  assert.deepEqual(await client.faqs("en-GB", POPULAR), [QUESTION]);
  assert.equal(stub.calls.length, 1, "served from cache inside 60 s");
  clock += 1;
  assert.deepEqual(await client.faqs("en-GB", POPULAR), [QUESTION]);
  assert.equal(stub.calls.length, 2);
  assert.equal(stub.calls[1].headers.get("if-none-match"), '"v1"');
  clock += 1000;
  await client.faqs("en-GB", POPULAR);
  assert.equal(stub.calls.length, 2, "a 304 restarts the 60 s window");
  await client.faqs("zh-CN", POPULAR);
  assert.equal(stub.calls.length, 3, "each locale has its own entry");
  assert.match(stub.calls[2].url, /locale=zh-CN/);
});

test("FAQs: stale data on error, null when nothing is cached; malformed rows (and unknown categories) are dropped", async () => {
  let clock = 0;
  let mode: "ok" | "fail" | "throw" = "fail";
  const stub = stubFetch(() => {
    if (mode === "throw") throw new TypeError("fetch failed");
    if (mode === "fail") return json({ type: "x", code: "boom" }, 500);
    return json({ faqs: [QUESTION, { id: 5 }, { ...QUESTION, id: "0192d4f0-7b6a-7c3e-9a10-1234567890ac", answer: null }, { ...QUESTION, id: "0192d4f0-7b6a-7c3e-9a10-1234567890ad", category: "billing" }, { ...QUESTION, id: "q2" }] });
  });
  const client = createAdminHelpdeskClient({ fetch: stub.fetch, now: () => clock, log: (line) => logs.push(line) });
  assert.equal(await client.faqs("en-GB", POPULAR), null, "nothing cached: hide the column");
  clock += ADMIN_FAQS_RETRY_MS;
  mode = "ok";
  assert.deepEqual(await client.faqs("en-GB", POPULAR), [QUESTION]);
  clock += ADMIN_FAQS_TTL_MS;
  mode = "throw";
  assert.deepEqual(await client.faqs("en-GB", POPULAR), [QUESTION], "stale on error");
  mode = "fail";
  assert.deepEqual(await client.faqs("en-GB", POPULAR), [QUESTION]);
  assert.ok(logs.some((line) => line.event === "admin_faqs_failed"));
  assert.ok(!JSON.stringify(logs).includes(TOKEN), "the token is never logged");
});

test("a hanging Admin never holds the page: nothing cached -> hidden within the wait budget; the late answer is cached for the next load", async () => {
  assert.ok(ADMIN_FAQS_WAIT_MS <= 500, "the page waits at most half a second for Admin");
  let release: (response: Response) => void = () => undefined;
  const stub = stubFetch(() => new Promise<Response>((resolve) => { release = resolve; }));
  const client = createAdminHelpdeskClient({ fetch: stub.fetch, log: (line) => logs.push(line), timeouts: { wait: 40, faqs: 5_000 } });
  const started = Date.now();
  assert.equal(await client.faqs("en-GB", POPULAR), null);
  assert.ok(Date.now() - started < 1_000, `waited ${Date.now() - started} ms`);
  assert.equal(await client.faqs("en-GB", POPULAR), null, "a second load while the first request is still out");
  assert.equal(stub.calls.length, 1, "one request in flight per locale");
  release(json({ faqs: [QUESTION] }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(await client.faqs("en-GB", POPULAR), [QUESTION]);
  assert.equal(stub.calls.length, 1);
});

test("stale FAQs are served at once while they are revalidated in the background", async () => {
  let clock = 0;
  let hang = false;
  let release: (response: Response) => void = () => undefined;
  const stub = stubFetch(() => hang ? new Promise<Response>((resolve) => { release = resolve; }) : json({ faqs: [QUESTION] }, 200, { etag: '"v1"' }));
  const client = createAdminHelpdeskClient({ fetch: stub.fetch, now: () => clock, log: (line) => logs.push(line), timeouts: { wait: 5_000, faqs: 10_000 } });
  assert.deepEqual(await client.faqs("en-GB", POPULAR), [QUESTION]);
  clock += ADMIN_FAQS_TTL_MS;
  hang = true;
  const started = Date.now();
  assert.deepEqual(await client.faqs("en-GB", POPULAR), [QUESTION]);
  assert.ok(Date.now() - started < 1_000, "the stale copy does not wait for Admin");
  assert.equal(stub.calls.length, 2);
  release(json({ faqs: [{ ...QUESTION, question: "Updated?" }] }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal((await client.faqs("en-GB", POPULAR))?.[0].question, "Updated?");
});

test("an outage costs one request per retry window, not one per page load", async () => {
  let clock = 0;
  const stub = stubFetch(() => json({ code: "down" }, 503));
  const client = createAdminHelpdeskClient({ fetch: stub.fetch, now: () => clock, log: (line) => logs.push(line) });
  assert.equal(await client.faqs("en-GB", POPULAR), null);
  assert.equal(await client.faqs("en-GB", POPULAR), null);
  clock += ADMIN_FAQS_RETRY_MS - 1;
  assert.equal(await client.faqs("en-GB", POPULAR), null);
  assert.equal(stub.calls.length, 1);
  clock += 1;
  assert.equal(await client.faqs("en-GB", POPULAR), null);
  assert.equal(stub.calls.length, 2);
  assert.equal(logs.filter((line) => line.event === "admin_faqs_failed").length, 2);
});

test("not configured: no request, FAQs null, no suggestion, outcome not delivered; env is read on every call", async () => {
  const stub = stubFetch(() => json({ faqs: [QUESTION] }));
  const client = createAdminHelpdeskClient({ fetch: stub.fetch });
  delete process.env.ADMIN_HELPDESK_TOKEN;
  assert.equal(await client.faqs("en-GB", POPULAR), null);
  assert.equal(await client.faq(QUESTION.id, "en-GB"), null);
  assert.equal(await client.suggest({ learnerId: "u1", locale: "en-GB", source: "submit", category: "other", subject: "s", message: "m", runId: RUN_ID, parentRunId: null }), null);
  assert.equal(await client.reportOutcome(SUGGESTION.id, "solved"), false);
  process.env.ADMIN_HELPDESK_TOKEN = TOKEN;
  process.env.ADMIN_HELPDESK_BASE_URL = "ftp://admin.local";
  assert.equal(await client.faqs("en-GB", POPULAR), null, "only http(s) base URLs");
  assert.equal(stub.calls.length, 0);
  process.env.ADMIN_HELPDESK_BASE_URL = BASE;
  assert.deepEqual(await client.faqs("en-GB", POPULAR), [QUESTION]);
  process.env.ADMIN_HELPDESK_TOKEN = `${TOKEN}-rotated`;
  clearFaqCache();
  await client.faqs("en-GB", POPULAR);
  assert.equal(stub.calls.at(-1)?.headers.get("authorization"), `Bearer ${TOKEN}-rotated`);
});

test("suggest (source submit): posts the learner's enquiry and returns the stored answer", async () => {
  const stub = stubFetch(() => json({ suggestion: SUGGESTION }));
  const client = createAdminHelpdeskClient({ fetch: stub.fetch });
  const input = { learnerId: "u1", locale: "en-GB" as const, source: "submit" as const, category: "technical_support" as const, subject: "Cannot log in", message: "It says invalid password", runId: RUN_ID, parentRunId: ROOT_ID };
  assert.deepEqual(await client.suggest(input), SUGGESTION);
  assert.equal(stub.calls[0].method, "POST");
  assert.equal(stub.calls[0].url, `${BASE}/api/integration/helpdesk/suggest`);
  assert.equal(stub.calls[0].headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.equal(stub.calls[0].headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(stub.calls[0].body || ""), input);
});

test("suggest returns null on no match, any error, a malformed body, or the timeout", async () => {
  const input = { learnerId: "u1", locale: "zh-CN" as const, source: "chat" as const, message: "m", runId: RUN_ID, parentRunId: null };
  for (const handler of [
    () => json({ suggestion: null }),
    () => json({ type: "x" }, 429),
    () => json({ suggestion: { id: "x" } }),
    () => json({ suggestion: { ...SUGGESTION, faqId: "not-a-uuid" } }),
    () => json({ suggestion: { id: SUGGESTION.id, qaId: QUESTION.id, question: "q", answer: "a" } }),
    () => new Response("not json", { status: 200 }),
    () => { throw new TypeError("fetch failed"); }
  ]) {
    assert.equal(await createAdminHelpdeskClient({ fetch: stubFetch(handler).fetch, log: (line) => logs.push(line) }).suggest(input), null);
  }
  const hanging = stubFetch((_call, signal) => new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason));
  }));
  const started = Date.now();
  assert.equal(await createAdminHelpdeskClient({ fetch: hanging.fetch, timeouts: { suggest: 50 } }).suggest(input), null);
  assert.ok(Date.now() - started < 2_000, "the timeout aborts the request");
});

test("outcome: posts { outcome } to the suggestion and reports whether Admin accepted it", async () => {
  const ok = stubFetch(() => new Response(null, { status: 204 }));
  assert.equal(await createAdminHelpdeskClient({ fetch: ok.fetch }).reportOutcome(SUGGESTION.id, "declined"), true);
  assert.equal(ok.calls[0].url, `${BASE}/api/integration/helpdesk/suggestions/${SUGGESTION.id}/outcome`);
  assert.equal(ok.calls[0].method, "POST");
  assert.deepEqual(JSON.parse(ok.calls[0].body || ""), { outcome: "declined" });
  assert.equal(ok.calls[0].headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.equal(await createAdminHelpdeskClient({ fetch: stubFetch(() => json({}, 404)).fetch }).reportOutcome(SUGGESTION.id, "solved"), false);
  assert.equal(await createAdminHelpdeskClient({ fetch: stubFetch(() => { throw new Error("down"); }).fetch }).reportOutcome(SUGGESTION.id, "edited"), false);
});

test("suggest (chat / chip): source, and faqId only for a chip; optional fields are left out, not sent empty; runId and parentRunId always go last", async () => {
  const stub = stubFetch(() => json({ suggestion: SUGGESTION }));
  const client = createAdminHelpdeskClient({ fetch: stub.fetch });
  await client.suggest({ learnerId: "u1", locale: "en-GB", source: "chat", message: "reset email never arrives", runId: ROOT_ID, parentRunId: null });
  await client.suggest({ learnerId: "u1", locale: "zh-CN", source: "chip", message: QUESTION.question, faqId: QUESTION.id, runId: RUN_ID, parentRunId: ROOT_ID });
  assert.equal(stub.calls[0].body, JSON.stringify({ learnerId: "u1", locale: "en-GB", source: "chat", message: "reset email never arrives", runId: ROOT_ID, parentRunId: null }));
  assert.equal(stub.calls[1].body, JSON.stringify({ learnerId: "u1", locale: "zh-CN", source: "chip", message: QUESTION.question, faqId: QUESTION.id, runId: RUN_ID, parentRunId: ROOT_ID }));
});

test("traceparent (W3C): every Admin call carries one; the incoming request's trace is continued with a new span per call", async () => {
  const incoming = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
  const stub = stubFetch((call) => call.url.includes("/suggest") ? json({ suggestion: SUGGESTION }) : call.url.includes("/outcome") ? new Response(null, { status: 204 }) : call.url.includes("/faqs/") ? json(QUESTION) : json({ faqs: [QUESTION] }));
  const client = createAdminHelpdeskClient({ fetch: stub.fetch, traceparent: incoming });
  await client.faqs("en-GB", POPULAR);
  await client.faq(QUESTION.id, "en-GB");
  await client.suggest({ learnerId: "u1", locale: "en-GB", source: "chat", message: "m", runId: RUN_ID, parentRunId: null });
  await client.reportOutcome(SUGGESTION.id, "helpful");
  assert.equal(stub.calls.length, 4);
  const sent = stub.calls.map((call) => call.headers.get("traceparent") ?? "");
  for (const value of sent) assert.match(value, /^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/);
  assert.equal(new Set(sent.map((value) => value.split("-")[2])).size, 4, "a new span id per call");
  assert.ok(!sent.some((value) => value.includes("00f067aa0ba902b7")), "never our caller's span id");
});

test("traceparent (W3C): without a valid incoming header each call starts a valid new trace", async () => {
  for (const traceparent of [undefined, null, "garbage", "ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"]) {
    const stub = stubFetch(() => json({ suggestion: null }));
    await createAdminHelpdeskClient({ fetch: stub.fetch, traceparent }).suggest({ learnerId: "u1", locale: "en-GB", source: "chat", message: "m", runId: RUN_ID, parentRunId: null });
    const value = stub.calls[0].headers.get("traceparent") ?? "";
    assert.match(value, /^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/);
    assert.notEqual(value.split("-")[1], "4bf92f3577b34da6a3ce929d0e0e4736");
  }
});

test("outcome: the chat's helpful / not_helpful go to the same endpoint", async () => {
  const ok = stubFetch(() => json({ id: SUGGESTION.id, outcome: "helpful", changed: true }));
  const client = createAdminHelpdeskClient({ fetch: ok.fetch });
  assert.equal(await client.reportOutcome(SUGGESTION.id, "helpful"), true);
  assert.equal(await client.reportOutcome(SUGGESTION.id, "not_helpful"), true);
  assert.deepEqual(ok.calls.map((call) => JSON.parse(call.body || "")), [{ outcome: "helpful" }, { outcome: "not_helpful" }]);
});

test("FAQ list filters: category, search text and limit in a fixed order; each query is cached on its own", async () => {
  const stub = stubFetch(() => json({ faqs: [QUESTION] }));
  const client = createAdminHelpdeskClient({ fetch: stub.fetch });
  await client.faqs("zh-CN", { category: "payments_subscriptions", q: "invoice", limit: 50 });
  await client.faqs("zh-CN", { category: "payments_subscriptions", q: "invoice", limit: 50 });
  await client.faqs("zh-CN", { q: "发票" });
  await client.faqs("en-GB", { limit: 500 });
  assert.deepEqual(stub.calls.map((call) => call.url.replace(BASE, "")), [
    "/api/integration/helpdesk/faqs?locale=zh-CN&category=payments_subscriptions&q=invoice&limit=50",
    `/api/integration/helpdesk/faqs?locale=zh-CN&q=${encodeURIComponent("发票")}`,
    "/api/integration/helpdesk/faqs?locale=en-GB&limit=100"
  ]);
});

test("FAQ cache keeps at most ADMIN_FAQS_CACHE_ENTRIES queries (searches cannot grow it without bound)", async () => {
  const stub = stubFetch(() => json({ faqs: [QUESTION] }));
  // One search a second stays inside the per-minute search budget.
  let clock = 5_000_000;
  const client = createAdminHelpdeskClient({ fetch: stub.fetch, now: () => (clock += 1_000) });
  for (let index = 0; index <= ADMIN_FAQS_CACHE_ENTRIES; index += 1) await client.faqs("en-GB", { q: `query ${index}` });
  await client.faqs("en-GB", { q: `query ${ADMIN_FAQS_CACHE_ENTRIES}` });
  assert.equal(stub.calls.length, ADMIN_FAQS_CACHE_ENTRIES + 1, "the newest entry is still cached");
  await client.faqs("en-GB", { q: "query 0" });
  assert.equal(stub.calls.length, ADMIN_FAQS_CACHE_ENTRIES + 2, "the oldest entry was evicted");
});

test("single FAQ: GET /faqs/{id}?locale=, bare or wrapped as { faq }; 404 and bad ids are null; cached", async () => {
  let mode: "bare" | "wrapped" | "missing" = "bare";
  const stub = stubFetch(() => mode === "missing" ? json({ code: "not_found" }, 404) : json(mode === "bare" ? QUESTION : { faq: QUESTION }));
  const client = createAdminHelpdeskClient({ fetch: stub.fetch });
  assert.deepEqual(await client.faq(QUESTION.id.toUpperCase(), "en-GB"), QUESTION);
  assert.equal(stub.calls[0].url, `${BASE}/api/integration/helpdesk/faqs/${QUESTION.id}?locale=en-GB`);
  assert.deepEqual(await client.faq(QUESTION.id, "en-GB"), QUESTION);
  assert.equal(stub.calls.length, 1, "cached");
  mode = "wrapped";
  assert.deepEqual(await client.faq(QUESTION.id, "zh-CN"), QUESTION);
  mode = "missing";
  const other = "0192d4f0-7b6a-7c3e-9a10-1234567890ff";
  assert.equal(await client.faq(other, "en-GB"), null);
  assert.equal(await client.faq("../../tickets", "en-GB"), null);
  assert.equal(stub.calls.length, 3, "a bad id never reaches Admin");
});

test("searches and deep links have their own bounded cache: unique ?q= values never evict the popular list", async () => {
  let clock = 9_000_000;
  let down = false;
  const stub = stubFetch(() => (down ? json({}, 503) : json({ faqs: [QUESTION] })));
  const client = createAdminHelpdeskClient({ fetch: stub.fetch, now: () => clock, log: () => undefined });
  await client.faqs("en-GB", POPULAR);
  for (let index = 0; index < ADMIN_FAQS_CACHE_ENTRIES + 20; index += 1) {
    clock += 600; // inside the per-minute search budget
    await client.faqs("en-GB", { q: `unique ${index}`, limit: 50 });
  }
  assert.deepEqual(faqCacheSizes(), { lists: 1, searches: ADMIN_FAQS_CACHE_ENTRIES, failed: 0 });
  // Admin goes down: the popular list is still there to serve stale.
  down = true;
  clock += 60_000;
  assert.deepEqual(await client.faqs("en-GB", POPULAR), [QUESTION]);
});

test("failed lookups are remembered in a bounded map: an outage plus unique ?q= values cannot grow memory", async () => {
  let clock = 20_000_000;
  const stub = stubFetch(() => json({}, 503));
  const client = createAdminHelpdeskClient({ fetch: stub.fetch, now: () => (clock += 1_000), log: () => undefined });
  for (let index = 0; index < ADMIN_FAQS_CACHE_ENTRIES * 3; index += 1) assert.equal(await client.faqs("en-GB", { q: `outage ${index}` }), null);
  assert.ok(faqCacheSizes().failed <= ADMIN_FAQS_CACHE_ENTRIES, `failed keys: ${faqCacheSizes().failed}`);
});

test("uncached searches and deep links are throttled per instance: over ADMIN_SEARCHES_PER_MINUTE Admin is not asked", async () => {
  let clock = 30_000_000;
  const stub = stubFetch(() => json({ faqs: [QUESTION] }));
  const client = createAdminHelpdeskClient({ fetch: stub.fetch, now: () => clock, log: (line) => logs.push(line) });
  assert.equal(ADMIN_SEARCHES_PER_MINUTE, 120);
  for (let index = 0; index < ADMIN_SEARCHES_PER_MINUTE; index += 1) assert.ok(await client.faqs("en-GB", { q: `burst ${index}` }));
  assert.equal(await client.faqs("en-GB", { q: "one too many" }), null);
  assert.equal(await client.faq("0192d4f0-7b6a-7c3e-9a10-00000000beef", "en-GB"), null);
  assert.equal(stub.calls.length, ADMIN_SEARCHES_PER_MINUTE, "Admin is not asked over the budget");
  assert.ok(logs.some((line) => line.event === "admin_faqs_throttled"));
  assert.ok(await client.faqs("en-GB", { q: "burst 3" }), "a cached search is still answered");
  assert.ok(await client.faqs("en-GB", POPULAR), "lists are never throttled");
  clock += 60_001;
  assert.ok(await client.faqs("en-GB", { q: "one too many" }), "the budget refills after a minute");
});

test("search text is normalised before it becomes a cache key: case and spacing do not make a new Admin call", async () => {
  const stub = stubFetch(() => json({ faqs: [QUESTION] }));
  const client = createAdminHelpdeskClient({ fetch: stub.fetch });
  await client.faqs("en-GB", { q: "  Invoice   PDF " });
  await client.faqs("en-GB", { q: "invoice pdf" });
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0].url, `${BASE}/api/integration/helpdesk/faqs?locale=en-GB&q=invoice+pdf`);
});

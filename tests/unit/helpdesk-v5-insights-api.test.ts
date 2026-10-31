// Helpdesk v5 Part G API-level tests: the real Route Handlers of the
// flywheel feed (GET /api/integration/helpdesk/insights) and of the 180-day
// retention job (GET .../jobs/assist-retention, POST .../run) with the
// integration bearer, the DEV-only local storage and the real product store
// (whose account name and email the scrubber removes).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AssistRecord } from "../../modules/helpdesk/repository";

const cwd = process.cwd();
const env = { ...process.env };
const ORIGIN = "http://localhost:3000";
const TOKEN = "local-test-helpdesk-token-insights-0123";
const DAY = 86_400_000;
type Params = { params: Promise<Record<string, string>> };
type Handler = (request: Request, context: Params) => Promise<Response>;
let directory = "";
let routes: Record<"insights" | "runs" | "run", Record<string, Handler>>;
let learnerId = "";
let repository: import("../../modules/helpdesk/repository").HelpdeskRepository;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lg-helpdesk-insights-api-"));
  process.chdir(directory);
  process.env.APP_ENV = "DEV";
  process.env.STORAGE_BACKEND = "local";
  process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  delete process.env.DATABASE_URL;
  delete process.env.PORTAL_HELPDESK_TOKEN;
  process.env.ADMIN_HOSTS = "admin.ilovelearningguide.com,admin.sit.ilovelearningguide.com";
  const store = await import("../../services/productStore");
  const user = await store.registerUser({ email: "wen.insights88@example.test", password: "password1", nickname: "Wen Insights" });
  learnerId = user.id;
  repository = (await import("../../repositories/helpdeskRepository")).helpdeskRepository();
  routes = {
    insights: await import("../../app/api/integration/helpdesk/insights/route"),
    runs: await import("../../app/api/integration/helpdesk/jobs/assist-retention/route"),
    run: await import("../../app/api/integration/helpdesk/jobs/assist-retention/run/route")
  } as unknown as typeof routes;
});

after(async () => {
  process.chdir(cwd);
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
  if (directory && path.dirname(directory) === tmpdir()) await rm(directory, { recursive: true, force: true });
});

function agentRequest(url: string, init: { token?: string | null; key?: string; json?: unknown; raw?: string } = {}) {
  const headers = new Headers({ host: "localhost:3000" });
  if (init.token !== null) headers.set("authorization", `Bearer ${init.token ?? TOKEN}`);
  if (init.key) headers.set("idempotency-key", init.key);
  const body = init.raw ?? (init.json === undefined ? undefined : JSON.stringify(init.json));
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`${ORIGIN}${url}`, { method: body === undefined ? "GET" : "POST", headers, body });
}

const ctx = (): Params => ({ params: Promise.resolve({}) });

async function problem(response: Response, status: number, code: string) {
  assert.equal(response.status, status, `${code}: ${await response.clone().text()}`);
  assert.match(response.headers.get("content-type") || "", /^application\/problem\+json/);
  assert.equal((await response.json()).code, code);
}

function row(ageMs: number, patch: Partial<AssistRecord> = {}): AssistRecord {
  return {
    id: randomUUID(), learnerId, source: "chat", locale: "zh-CN", question: "我是 Wen Insights，邮箱 wen.insights88@example.test，电话 +86 138 0013 8000，订单 order_abc123def456 一直没到账",
    faqId: null, faqQuestion: null, answer: null, feedback: null, ticketId: null, clientEventId: randomUUID(), payloadHash: null, createdAt: new Date(Date.now() - ageMs).toISOString(),
    feedbackDeliveredAt: null, feedbackAttemptedAt: null, alternatives: [], sessionId: null, turnIndex: null, nodeId: null, parentNodeId: null, via: "typed", kind: "no_match", intent: "question",
    guard: "passed", releaseVersion: 3, traceId: "0af7651916cd43dd8448eb211c80319c", signals: ["payment_failed"], blocks: null, expanded: null, covered: null, texts: null, ...patch
  };
}

const insights = (query: string, token?: string | null) => routes.insights.GET(agentRequest(`/api/integration/helpdesk/insights${query}`, { token }), ctx());

test("insights: integration bearer like the other routes; since is required", async () => {
  await problem(await insights("?since=2026-01-01T00:00:00.000Z"), 503, "integration_disabled");
  process.env.PORTAL_HELPDESK_TOKEN = TOKEN;
  await problem(await insights("?since=2026-01-01T00:00:00.000Z", null), 401, "invalid_token");
  await problem(await insights("?since=2026-01-01T00:00:00.000Z", "nope"), 401, "invalid_token");
  await problem(await insights(""), 400, "validation_failed");
  await problem(await insights("?since=yesterday"), 400, "validation_failed");
  await problem(await insights("?since=2026-01-01T00:00:00.000Z&cursor=not-a-cursor"), 400, "validation_failed");
});

test("insights: a page of scrubbed turns and labels; the account name and email never leave; the same cursor answers the same page", async () => {
  process.env.PORTAL_HELPDESK_TOKEN = TOKEN;
  const first = row(10 * 60_000);
  const second = row(9 * 60_000, { question: "How do I change my plan?", locale: "en-GB", kind: "answer", intent: "question", faqId: "faq-plan", answer: "Open Settings.", feedback: "helpful" });
  const recent = row(5_000, { question: "just now" });
  for (const item of [first, second, recent]) assert.equal(await repository.insertAssist(item), "inserted");
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const response = await insights(`?since=${encodeURIComponent(since)}&limit=1`);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "no-store");
  const page = await response.json() as { turns: Array<Record<string, unknown>>; nextCursor: string | null; until: string };
  assert.equal(page.turns.length, 1);
  const [turn] = page.turns;
  assert.equal(turn.id, first.id);
  const text = String(turn.text);
  for (const leaked of ["Wen", "Insights", "wen.insights88", "example.test", "138", "8000", "order_abc123def456"]) assert.ok(!text.includes(leaked), `${leaked} left in ${text}`);
  assert.match(text, /一直没到账/);
  assert.equal(turn.kind, "no_match");
  assert.equal(turn.guard, "passed");
  assert.deepEqual(turn.signals, ["payment_failed"]);
  const body = JSON.stringify(page);
  for (const leaked of [learnerId, "traceId", "learnerId", "0af7651916cd43dd8448eb211c80319c"]) assert.ok(!body.includes(leaked), `${leaked} in the feed`);
  assert.ok(page.nextCursor);

  const again = await (await insights(`?since=${encodeURIComponent(since)}&limit=1`)).json() as typeof page;
  assert.equal(again.turns[0]?.id, first.id, "read-only: the same request answers the same turns");
  const next = await (await insights(`?since=${encodeURIComponent(since)}&limit=1&cursor=${page.nextCursor}`)).json() as typeof page;
  assert.deepEqual(next.turns.map((item) => item.id), [second.id]);
  assert.equal(next.turns[0]?.vote, "helpful");
  assert.equal(next.turns[0]?.answered, true);
  assert.ok(!JSON.stringify(next).includes("Open Settings."), "never the answer text");
  assert.equal(next.until, page.until, "the cursor keeps the window");
  assert.equal(next.nextCursor, null, "a turn younger than a minute waits for the next read");
  assert.ok(!JSON.stringify(next).includes(recent.id));
});

test("retention job: staff run now scrubs rows older than 180 days, idempotent by key; the runs list shows it", async () => {
  process.env.PORTAL_HELPDESK_TOKEN = TOKEN;
  const old = row(181 * DAY);
  const young = row(179 * DAY);
  for (const item of [old, young]) assert.equal(await repository.insertAssist(item), "inserted");
  const agent = { id: "emp-7", name: "Support Sam" };
  const run = (init: { key?: string; json?: unknown; raw?: string; token?: string | null }) => routes.run.POST(agentRequest("/api/integration/helpdesk/jobs/assist-retention/run", init), ctx());

  await problem(await run({ json: { agent }, token: null }), 401, "invalid_token");
  await problem(await run({ json: { agent } }), 400, "idempotency_key_required");
  await problem(await run({ key: randomUUID(), json: { agent: { id: "", name: "x" } } }), 400, "validation_failed");
  await problem(await run({ key: randomUUID(), raw: "{" }), 400, "invalid_request");

  const key = randomUUID();
  const response = await run({ key, json: { agent } });
  assert.equal(response.status, 200, await response.clone().text());
  const done = await response.json() as { outcome: string; run: Record<string, unknown> };
  assert.equal(done.outcome, "completed");
  assert.equal(done.run.trigger, "manual");
  assert.equal(done.run.status, "succeeded");
  assert.equal(done.run.rowsScrubbed, 1);
  assert.deepEqual(done.run.requestedBy, agent);
  assert.ok(!("instance" in done.run) && !("clientEventId" in done.run), "no instance name or key in the API");

  const rows = await repository.listRetentionDue(new Date(Date.now() - 180 * DAY).toISOString(), 10);
  assert.deepEqual(rows, [], "nothing left due");
  const feed = await (await insights(`?since=${encodeURIComponent(new Date(Date.now() - 182 * DAY).toISOString())}&limit=500`)).json() as { turns: Array<{ id: string; text: string }> };
  const scrubbed = feed.turns.find((item) => item.id === old.id);
  const kept = feed.turns.find((item) => item.id === young.id);
  assert.ok(scrubbed && kept);
  assert.equal(scrubbed.text, kept.text, "the feed sends the same scrubbed text before and after retention");

  const replay = await (await run({ key, json: { agent } })).json() as typeof done;
  assert.deepEqual(replay, done, "the same key answers with the same run");
  await problem(await run({ key, json: { agent: { id: "emp-8", name: "Other" } } }), 422, "idempotency_conflict");

  const list = await routes.runs.GET(agentRequest("/api/integration/helpdesk/jobs/assist-retention"), ctx());
  assert.equal(list.status, 200, await list.clone().text());
  const runs = await list.json() as { job: string; retentionDays: number; runs: Array<{ id: string }> };
  assert.equal(runs.job, "assist_retention");
  assert.equal(runs.retentionDays, 180);
  assert.deepEqual(runs.runs.map((item) => item.id), [done.run.id]);
  await problem(await routes.runs.GET(agentRequest("/api/integration/helpdesk/jobs/assist-retention", { token: "nope" }), ctx()), 401, "invalid_token");
});

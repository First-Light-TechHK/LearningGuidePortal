// PostgreSQL proofs for Helpdesk v5 Part G (migration 024): the outcome view
// links each assist turn to its enquiry (linked, or the learner's next one
// within 24 hours; resolved by the agent; the agent's last public reply),
// the flywheel feed pages by (createdAt, id) in SQL, the 180-day retention
// job replaces the raw text once, and the job's PostgreSQL session advisory
// lock and the day's run row let exactly one of several racing instances run
// it. Each racing call runs on its own pooled connection, so the database
// alone arbitrates.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { parseFaqRelease, parseInsightsQuery, parseSuggestTurn, type AdminSuggestReply, type AdminSuggestRequest, type FaqRelease } from "../../../contracts/helpdesk";
import { ensureSchema, getPool } from "../../../services/persistence/db";
import { createPostgresHelpdeskRepository } from "../../../repositories/helpdeskRepository";
import { createHelpdeskService } from "../../../modules/helpdesk/service";
import { createAssistantService } from "../../../modules/helpdesk/assistant";
import { createInsightsService } from "../../../modules/helpdesk/insights";
import { createRetentionJob } from "../../../modules/helpdesk/retention";
import type { AssistRecord, JobRunRecord } from "../../../modules/helpdesk/repository";
import { closePool, requireDatabaseUrl, rows } from "./harness";

const TABLES = ["helpdesk_job_runs", "helpdesk_ai_ratings", "helpdesk_assist_log", "helpdesk_chat_sessions", "helpdesk_ticket_tags", "helpdesk_ticket_events", "helpdesk_attachments", "helpdesk_ticket_messages", "helpdesk_tickets", "helpdesk_ticket_counters"];
const MIGRATION_024 = readFileSync(path.join(process.cwd(), "db", "migrations", "024_helpdesk_flywheel.sql"), "utf8");
const fixture = JSON.parse(readFileSync("tests/fixtures/helpdesk-contract.json", "utf8")) as { portalToAdmin: Record<string, Record<string, unknown>> };
const RELEASE = parseFaqRelease(fixture.portalToAdmin.faqReleaseResponse) as FaqRelease;
const learner = { id: "pg-insights-learner", email: "pg.insights77@example.test", name: "Lin Learner" };
const agent = { id: "emp-pg", name: "PG Agent" };
const DAY = 86_400_000;
const NOW = Date.parse("2026-10-30T09:00:00.000Z");
const accounts = async (ids: string[]) => new Map(ids.filter((value) => value === learner.id).map((value) => [value, { name: learner.name, email: learner.email }]));

function reply(input: AdminSuggestRequest): AdminSuggestReply {
  const body = structuredClone(fixture.portalToAdmin.suggestNoMatchContextResponse);
  const turn = parseSuggestTurn(body);
  return { suggestion: null, alternatives: [], ...(turn ? { turn } : {}) };
}

function harness() {
  let clock = NOW;
  const now = () => new Date(clock);
  const repository = createPostgresHelpdeskRepository();
  const assistant = createAssistantService({
    repository, now, log: () => undefined,
    admin: { async suggest() { return null; }, async suggestReply(input: AdminSuggestRequest) { return reply(input); }, async reportOutcome() { return true; }, async faqs() { return []; }, async faq() { return null; } },
    release: { async current(locale) { return locale === RELEASE.locale ? RELEASE : null; } },
    learnerRecords: async () => ({ user: { email: learner.email, emailVerifiedAt: "2026-01-01T00:00:00.000Z" }, orders: [], subscriptions: [] })
  });
  const service = createHelpdeskService({ repository, blobs: { async put() {}, async get() { return new Uint8Array(); } }, now, log: () => undefined });
  const insights = createInsightsService({ repository, accounts, now: () => new Date(clock + 10 * 60_000) });
  return { repository, assistant, service, insights, advance(ms: number) { clock += ms; } };
}

function row(createdAt: number, patch: Partial<AssistRecord> = {}): AssistRecord {
  return {
    id: randomUUID(), learnerId: learner.id, source: "chat", locale: "zh-CN", question: "我叫 Lin Learner，手机 13800138000，邮箱 pg.insights77@example.test，退款怎么申请", faqId: null, faqQuestion: null, answer: null,
    feedback: null, ticketId: null, clientEventId: randomUUID(), payloadHash: null, createdAt: new Date(createdAt).toISOString(), feedbackDeliveredAt: null, feedbackAttemptedAt: null,
    alternatives: [], sessionId: null, turnIndex: null, nodeId: null, parentNodeId: null, via: "typed", kind: "no_match", intent: "question", guard: null, releaseVersion: 3, traceId: null,
    signals: ["payment_failed"], blocks: null, expanded: null, covered: null, texts: null, ...patch
  };
}

before(async () => {
  requireDatabaseUrl();
  await getPool().query(`DROP VIEW IF EXISTS helpdesk_assist_outcomes`);
  await getPool().query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`);
});

after(async () => {
  await closePool();
});

beforeEach(async () => {
  await ensureSchema();
  await getPool().query(`TRUNCATE ${TABLES.join(", ")} CASCADE`);
});

test("the runtime bootstrap creates the 024 objects and the artifact re-applies cleanly", async () => {
  const present = await rows<{ name: string | null }>(`SELECT to_regclass(name)::text AS name FROM unnest($1::text[]) AS name`, [["helpdesk_job_runs", "helpdesk_assist_outcomes", "helpdesk_assist_log_retention_idx", "helpdesk_job_runs_daily_idx"]]);
  assert.deepEqual(present.map((item) => item.name), ["helpdesk_job_runs", "helpdesk_assist_outcomes", "helpdesk_assist_log_retention_idx", "helpdesk_job_runs_daily_idx"]);
  await getPool().query(MIGRATION_024);
  await getPool().query(MIGRATION_024);
  const columns = await rows<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'helpdesk_assist_log' AND column_name = 'scrubbed_at'");
  assert.equal(columns.length, 1);
});

async function coldStartBootstrap() {
  const db = path.join(process.cwd(), "services", "persistence", "db.ts");
  const script = `const loaded = await import(${JSON.stringify(db)}); const { ensureSchema, getPool } = loaded.ensureSchema ? loaded : loaded.default; await ensureSchema(); await getPool().end();`;
  await promisify(execFile)(process.execPath, ["--import", "tsx", "--require", path.join(process.cwd(), "scripts", "register-tsconfig-paths.cjs"), "--input-type=module", "-e", script], { env: process.env, timeout: 60_000 });
}

test("024 by the runtime bootstrap: a database at 023 with logged turns gains the run table, the view and scrubbed_at on start; old rows are not yet scrubbed", async () => {
  const repository = createPostgresHelpdeskRepository();
  const old = row(NOW - 200 * DAY);
  assert.equal(await repository.insertAssist(old), "inserted");
  await getPool().query("DROP VIEW helpdesk_assist_outcomes");
  await getPool().query("DROP TABLE helpdesk_job_runs");
  await getPool().query("ALTER TABLE helpdesk_assist_log DROP COLUMN scrubbed_at");
  await coldStartBootstrap();
  const present = await rows<{ name: string | null }>(`SELECT to_regclass(name)::text AS name FROM unnest($1::text[]) AS name`, [["helpdesk_job_runs", "helpdesk_assist_outcomes"]]);
  assert.deepEqual(present.map((item) => item.name), ["helpdesk_job_runs", "helpdesk_assist_outcomes"]);
  assert.deepEqual((await repository.listRetentionDue(new Date(NOW - 180 * DAY).toISOString(), 10)).map((item) => item.id), [old.id]);
});

test("the outcome view: a linked enquiry resolved by the agent with its last public reply; the next enquiry within 24 hours; none after 25 hours", async () => {
  const h = harness();
  const { sessionId } = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  const first = await h.assistant.ask(learner, { message: "still basic after paying", locale: "en-GB", faqId: null, sessionId }, randomUUID());
  h.advance(1000);
  const second = await h.assistant.ask(learner, { message: "it still does not work", locale: "en-GB", faqId: null, sessionId }, randomUUID());
  h.advance(60_000);
  const created = await h.service.createTicket(learner, { category: "payments_subscriptions", subject: "Paid, still Basic", body: "Please check.", locale: "en-GB", files: [], assistIds: [first.response.id, second.response.id] }, randomUUID());
  const ticketId = created.ticket.id;
  let detail = await h.service.agentAction(ticketId, { action: "claim", agent, expectedSequence: created.ticket.sequence }, randomUUID());
  h.advance(1000);
  detail = await h.service.postAgentMessage(ticketId, { body: "Hi Lin Learner, I re-synced it; call 13800138000 if not.", internal: false, agent, expectedSequence: detail.ticket.sequence }, randomUUID());
  h.advance(1000);
  detail = await h.service.postAgentMessage(ticketId, { body: "internal: refund 199", internal: true, agent, expectedSequence: detail.ticket.sequence }, randomUUID());
  detail = await h.service.agentAction(ticketId, { action: "propose_resolution", agent, expectedSequence: detail.ticket.sequence }, randomUUID());
  await h.service.learnerAction(learner, ticketId, { action: "confirm", expectedSequence: detail.ticket.sequence }, randomUUID());
  h.advance(3_600_000);
  const later = await h.assistant.ask(learner, { message: "how do I change my plan", locale: "en-GB", faqId: null, sessionId: null }, randomUUID());
  h.advance(23 * 3_600_000);
  await h.service.createTicket(learner, { category: "other", subject: "Change plan", body: "How?", locale: "en-GB", files: [] }, randomUUID());
  h.advance(1000);
  const lonely = await h.assistant.ask(learner, { message: "where are my certificates", locale: "en-GB", faqId: null, sessionId: null }, randomUUID());
  h.advance(25 * 3_600_000);
  await h.service.createTicket(learner, { category: "other", subject: "Certificates", body: "Where?", locale: "en-GB", files: [] }, randomUUID());

  const view = await rows<{ assist_id: string; ticket_id: string | null; ticket_linked: boolean | null; resolved_by_agent: boolean | null; close_reason: string | null; agent_reply_id: string | null }>(
    "SELECT assist_id, ticket_id, ticket_linked, resolved_by_agent, close_reason, agent_reply_id FROM helpdesk_assist_outcomes WHERE assist_id = ANY($1::uuid[])", [[first.response.id, later.response.id, lonely.response.id]]);
  const byAssist = new Map(view.map((item) => [item.assist_id, item]));
  assert.equal(byAssist.get(first.response.id)?.ticket_linked, true);
  assert.equal(byAssist.get(first.response.id)?.resolved_by_agent, true);
  assert.equal(byAssist.get(first.response.id)?.close_reason, "user_confirmed");
  assert.ok(byAssist.get(first.response.id)?.agent_reply_id);
  assert.equal(byAssist.get(later.response.id)?.ticket_linked, false);
  assert.equal(byAssist.get(later.response.id)?.ticket_id !== null, true);
  assert.equal(byAssist.get(lonely.response.id)?.ticket_id, null, "no enquiry within 24 hours");
  assert.equal(byAssist.get(lonely.response.id)?.resolved_by_agent, false);

  const { turns } = await h.insights.page(parseInsightsQuery(new URLSearchParams("since=2026-10-30T00:00:00Z")));
  const byId = new Map(turns.map((turn) => [turn.id, turn]));
  assert.deepEqual(byId.get(first.response.id)?.ticket, { linked: true, status: "CLOSED", closeReason: "user_confirmed", resolvedByAgent: true, agentReplied: true, agentReply: "Hi <name>, I re-synced it; call <phone> if not." });
  assert.equal(byId.get(second.response.id)?.handover, true);
  assert.equal(byId.get(second.response.id)?.lastTurn, true);
  assert.deepEqual(byId.get(later.response.id)?.ticket, { linked: false, status: "OPEN", closeReason: null, resolvedByAgent: false, agentReplied: false, agentReply: null });
  assert.equal(byId.get(lonely.response.id)?.ticketAfterChat, false);
  assert.doesNotMatch(JSON.stringify(turns), /internal: refund|Paid, still Basic|LG-\d|pg-insights-learner|pg\.insights77/, "no internal note, subject, ticket number or learner");
});

test("the feed pages in SQL by (createdAt, id) with a fixed window end; same-millisecond turns are never skipped or repeated", async () => {
  const h = harness();
  const at = NOW - 3_600_000;
  const records = [row(at), row(at), row(at), row(at + 1), row(at + 2)];
  for (const item of records) assert.equal(await h.repository.insertAssist(item), "inserted");
  const expected = [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map((item) => item.id);
  const seen: string[] = [];
  let cursor: string | null = null;
  let until: string | null = null;
  do {
    const query: URLSearchParams = new URLSearchParams({ since: new Date(at - 1000).toISOString(), limit: "2", ...(cursor ? { cursor } : {}) });
    const page = await h.insights.page(parseInsightsQuery(query));
    if (until) assert.equal(page.until, until);
    until = page.until;
    for (const turn of page.turns) {
      seen.push(turn.id);
      assert.ok(!turn.text.includes("13800138000") && !turn.text.includes("Lin") && !turn.text.includes("pg.insights77"), turn.text);
    }
    cursor = page.nextCursor;
    if (cursor) await h.repository.insertAssist(row(at + 3));
  } while (cursor);
  assert.deepEqual(seen.slice(0, expected.length), expected);
  assert.equal(new Set(seen).size, seen.length, "no turn twice");
});

test("retention: rows older than 180 days are replaced once, scrubbed; newer rows keep the raw text", async () => {
  const h = harness();
  const old = row(NOW - 181 * DAY);
  const clarify = row(NOW - 200 * DAY, { kind: "clarify", answer: "Lin Learner，点「我的订阅」即可", texts: { opening: null, closing: null, reply: null, explanation: "Lin Learner，点「我的订阅」即可", nodeType: null } });
  const fresh = row(NOW - 179 * DAY);
  for (const item of [old, clarify, fresh]) assert.equal(await h.repository.insertAssist(item), "inserted");
  const job = createRetentionJob({ repository: h.repository, accounts, now: () => new Date(NOW), log: () => undefined, instance: "pg-a" });
  const ran = await job.runScheduled();
  assert.equal(ran.outcome, "ran");
  assert.equal(ran.run?.rowsScrubbed, 2);
  const stored = await rows<{ id: string; question: string; answer: string | null; explanation: string | null; scrubbed: boolean }>(
    "SELECT id::text, question, answer, texts->>'explanation' AS explanation, scrubbed_at IS NOT NULL AS scrubbed FROM helpdesk_assist_log ORDER BY created_at");
  const [c, o, f] = stored;
  assert.equal(c.id, clarify.id);
  assert.ok(c.scrubbed && o.scrubbed && !f.scrubbed);
  for (const text of [c.question, c.answer ?? "", c.explanation ?? "", o.question]) assert.doesNotMatch(text, /Lin|13800138000|pg\.insights77/);
  assert.equal(f.question, fresh.question, "a row younger than 180 days keeps the raw text");
  assert.equal((await job.runScheduled()).outcome, "done_today");
  const due = await h.repository.listRetentionDue(new Date(NOW - 180 * DAY).toISOString(), 10);
  assert.deepEqual(due, []);
  assert.equal(await h.repository.applyRetention([{ id: old.id, question: "again", answer: null, texts: null }], new Date(NOW).toISOString()), 0, "a scrubbed row is never replaced again");
  const runs = await rows<{ trigger: string; status: string; rows_scrubbed: number; instance: string }>("SELECT trigger, status, rows_scrubbed, instance FROM helpdesk_job_runs");
  assert.deepEqual(runs, [{ trigger: "schedule", status: "succeeded", rows_scrubbed: 2, instance: "pg-a" }]);
});

test("several instances tick at once: exactly one runs the day's job; the advisory lock is held only during the work", async () => {
  const seed = harness();
  for (let index = 0; index < 30; index += 1) await seed.repository.insertAssist(row(NOW - 190 * DAY + index));
  const jobs = ["pg-a", "pg-b", "pg-c", "pg-d"].map((instance) => createRetentionJob({ repository: createPostgresHelpdeskRepository(), accounts, now: () => new Date(NOW), log: () => undefined, instance, rules: { batchSize: 5 } }));
  const results = await Promise.all(jobs.map((job) => job.runScheduled()));
  assert.equal(results.filter((result) => result.outcome === "ran").length, 1, JSON.stringify(results.map((result) => result.outcome)));
  for (const result of results) assert.ok(["ran", "locked", "done_today"].includes(result.outcome));
  const runs = await rows<{ rows_scrubbed: number; status: string }>("SELECT rows_scrubbed, status FROM helpdesk_job_runs");
  assert.deepEqual(runs, [{ rows_scrubbed: 30, status: "succeeded" }]);

  const repository = createPostgresHelpdeskRepository();
  const other = createPostgresHelpdeskRepository();
  const held = await repository.withJobLock("assist_retention", async () => (await other.withJobLock("assist_retention", async () => "inner")));
  assert.deepEqual(held, { locked: true, value: { locked: false } }, "another connection cannot take the lock while it is held");
  assert.deepEqual(await other.withJobLock("assist_retention", async () => "after"), { locked: true, value: "after" }, "released afterwards");
  const failing = await repository.withJobLock("assist_retention", async () => { throw Object.assign(new Error("boom"), { code: "XX000" }); }).catch((error: { code?: string }) => error.code);
  assert.equal(failing, "XX000");
  assert.deepEqual(await other.withJobLock("assist_retention", async () => "released on error"), { locked: true, value: "released on error" });
});

test("job run rows: one scheduled run per day and one run per Idempotency-Key", async () => {
  const repository = createPostgresHelpdeskRepository();
  const base: JobRunRecord = {
    id: randomUUID(), job: "assist_retention", day: "2026-10-30", trigger: "schedule", status: "running", attempts: 1, startedAt: new Date(NOW).toISOString(), finishedAt: null,
    cutoff: new Date(NOW - 180 * DAY).toISOString(), rowsScrubbed: 0, moreDue: false, instance: "pg-a", requestedBy: null, clientEventId: null, errorCode: null
  };
  assert.equal(await repository.saveJobRun(base), "saved");
  assert.equal(await repository.saveJobRun({ ...base, status: "succeeded", finishedAt: new Date(NOW + 1000).toISOString(), rowsScrubbed: 3 }), "saved", "the same run is updated");
  assert.equal(await repository.saveJobRun({ ...base, id: randomUUID() }), "duplicate", "a second scheduled run for the day");
  const key = randomUUID();
  const manual = { ...base, id: randomUUID(), trigger: "manual" as const, requestedBy: agent, clientEventId: key };
  assert.equal(await repository.saveJobRun(manual), "saved");
  assert.equal(await repository.saveJobRun({ ...manual, id: randomUUID() }), "duplicate", "the same key twice");
  assert.equal((await repository.saveJobRun({ ...manual, id: randomUUID(), clientEventId: randomUUID() })), "saved", "manual runs are not limited per day");
  assert.equal((await repository.findScheduledRun("assist_retention", "2026-10-30"))?.rowsScrubbed, 3);
  assert.equal((await repository.findJobRunByKey(key))?.id, manual.id);
  assert.equal((await repository.listJobRuns("assist_retention", 10)).length, 3);
  await assert.rejects(getPool().query("INSERT INTO helpdesk_job_runs (id, job, run_day, trigger, status, started_at, cutoff) VALUES ($1, 'assist_retention', '2026-10-31', 'manual', 'running', now(), now())", [randomUUID()]), /check/i, "a manual run names who asked");
});

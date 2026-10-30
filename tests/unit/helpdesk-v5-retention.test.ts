// Helpdesk v5 Part G1: raw learner text is kept 180 days; after that only the
// scrubbed text and the labels stay. A daily in-process job does it: one
// holder at a time across instances (an advisory lock in PostgreSQL, see
// tests/io/postgres/helpdesk-insights.test.ts), at most one scheduled run per
// UTC day (a run row), observable (the run row and one structured log line,
// never text), bounded per run, and it never blocks startup. Staff can run it
// now (idempotent by Idempotency-Key, audited with who asked).
// Storage is the real DEV-only local repository.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ASSIST_RETENTION_DAYS, HelpdeskProblem } from "../../contracts/helpdesk";
import { startJobLoop } from "../../modules/helpdesk/jobScheduler";
import { createRetentionJob, scrubForRetention } from "../../modules/helpdesk/retention";
import type { AssistRecord, HelpdeskRepository } from "../../modules/helpdesk/repository";
import { createLocalHelpdeskRepository } from "../../repositories/helpdeskRepository";

let root = "";
before(async () => { root = await mkdtemp(path.join(tmpdir(), "lg-helpdesk-retention-")); });
after(async () => { if (root && path.dirname(root) === tmpdir()) await rm(root, { recursive: true, force: true }); });

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-30T03:00:00.000Z");
const learner = { id: "user-lin", name: "Lin Learner", email: "lin.learner42@example.test" };
const agent = { id: "emp-7", name: "Support Sam" };

function row(daysOld: number, patch: Partial<AssistRecord> = {}): AssistRecord {
  return {
    id: randomUUID(), learnerId: learner.id, source: "chat", locale: "zh-CN", question: "我叫 Lin Learner，手机 13800138000，退款怎么申请", faqId: null, faqQuestion: null, answer: null,
    feedback: "not_helpful", ticketId: null, clientEventId: randomUUID(), payloadHash: null, createdAt: new Date(NOW - daysOld * DAY).toISOString(), feedbackDeliveredAt: null, feedbackAttemptedAt: null,
    alternatives: [], sessionId: null, turnIndex: null, nodeId: null, parentNodeId: null, via: "typed", kind: "no_match", intent: "question", guard: null, releaseVersion: 3, traceId: null,
    signals: ["payment_failed"], blocks: null, expanded: null, covered: null, texts: null, ...patch
  };
}

function harness(options: { wrap?: (repository: HelpdeskRepository) => HelpdeskRepository; rules?: Parameters<typeof createRetentionJob>[0]["rules"] } = {}) {
  let clock = NOW;
  const base = createLocalHelpdeskRepository(path.join(root, randomUUID()));
  const repository = options.wrap ? options.wrap(base) : base;
  const logs: Array<Record<string, unknown>> = [];
  const accounts = async (ids: string[]) => new Map(ids.filter((value) => value === learner.id).map((value) => [value, { name: learner.name, email: learner.email }]));
  const job = createRetentionJob({ repository, accounts, now: () => new Date(clock), log: (line) => logs.push(line), instance: "test-instance", rules: options.rules });
  return { job, repository: base, logs, advance(ms: number) { clock += ms; } };
}

test("rows older than 180 days keep only scrubbed text and their labels; newer rows keep the raw text", async () => {
  const h = harness();
  const old = row(181);
  const clarify = row(200, { kind: "clarify", answer: "Lin Learner，点「我的订阅」即可", texts: { opening: null, closing: null, reply: null, explanation: "Lin Learner，点「我的订阅」即可", nodeType: null } });
  const answer = row(190, { kind: "answer", answer: "Email support@ilovelearningguide.com for refunds.", texts: { opening: "好的 Lin Learner：", closing: "还有问题吗？", reply: null, explanation: null, nodeType: "answer" } });
  const fresh = row(179);
  for (const item of [old, clarify, answer, fresh]) assert.equal(await h.repository.insertAssist(item), "inserted");
  const result = await h.job.runScheduled();
  assert.equal(result.outcome, "ran");
  assert.equal(result.run?.status, "succeeded");
  assert.equal(result.run?.rowsScrubbed, 3);
  assert.equal(result.run?.cutoff, new Date(NOW - ASSIST_RETENTION_DAYS * DAY).toISOString());
  const stored = async (item: AssistRecord) => (await h.repository.findAssist(item.id))!;
  assert.equal((await stored(old)).question, "我叫 <name>，手机 <phone>，退款怎么申请");
  assert.equal((await stored(clarify)).answer, "<name>，点「我的订阅」即可", "a clarify answer is the model's explanation: scrubbed too");
  assert.equal((await stored(clarify)).texts?.explanation, "<name>，点「我的订阅」即可");
  assert.equal((await stored(answer)).answer, answer.answer, "an FAQ answer is Admin's approved text: unchanged");
  assert.deepEqual((await stored(answer)).texts, { opening: "好的 <name>：", closing: "还有问题吗？", reply: null, explanation: null, nodeType: "answer" });
  assert.equal((await stored(fresh)).question, fresh.question, "inside 180 days the raw text stays");
  // Labels are kept as they were.
  const kept = await stored(old);
  assert.deepEqual([kept.kind, kept.intent, kept.feedback, kept.via, kept.releaseVersion, kept.signals, kept.createdAt], [old.kind, old.intent, old.feedback, old.via, old.releaseVersion, old.signals, old.createdAt]);
  // Observable: one structured line with counts and the run id, never text.
  const line = h.logs.find((entry) => entry.event === "job_run");
  assert.deepEqual({ ...line, durationMs: 0 }, { type: "helpdesk", event: "job_run", job: "assist_retention", trigger: "schedule", runId: result.run?.id, day: "2026-10-30", status: "succeeded", attempts: 1, rowsScrubbed: 3, moreDue: false, durationMs: 0, instance: "test-instance" });
  assert.doesNotMatch(JSON.stringify(h.logs), /13800138000|Lin Learner|退款/);
});

test("once per UTC day: a second tick the same day does nothing, the next day runs again (and has nothing left to change)", async () => {
  const h = harness();
  await h.repository.insertAssist(row(200));
  assert.equal((await h.job.runScheduled()).outcome, "ran");
  h.advance(6 * 3_600_000);
  const again = await h.job.runScheduled();
  assert.equal(again.outcome, "done_today");
  assert.equal((await h.job.listRuns()).runs.length, 1);
  h.advance(DAY);
  const tomorrow = await h.job.runScheduled();
  assert.equal(tomorrow.outcome, "ran");
  assert.equal(tomorrow.run?.day, "2026-10-31");
  assert.equal(tomorrow.run?.rowsScrubbed, 0, "scrubbed rows are never changed again");
  const runs = (await h.job.listRuns()).runs;
  assert.deepEqual(runs.map((run) => run.day), ["2026-10-31", "2026-10-30"], "newest first");
  assert.equal((await h.job.listRuns()).retentionDays, 180);
});

test("another holder of the lock (another instance) means this tick skips without a run row", async () => {
  const h = harness();
  await h.repository.insertAssist(row(200));
  const inside = await h.repository.withJobLock("assist_retention", () => h.job.runScheduled());
  assert.deepEqual(inside, { locked: true, value: { outcome: "locked", run: null } });
  assert.equal((await h.job.listRuns()).runs.length, 0);
  assert.ok(h.logs.some((line) => line.event === "job_skipped" && line.reason === "locked"));
  const manual = await h.repository.withJobLock("assist_retention", () => h.job.runManual(agent, randomUUID()));
  assert.deepEqual(manual, { locked: true, value: { outcome: "already_running", run: null } });
});

test("a failed run is recorded with its error code and retried on a later tick, at most three attempts a day; a run left running by a crashed instance is taken over", async () => {
  let failures = 2;
  const h = harness({ wrap: (repository) => ({ ...repository, async applyRetention(updates, atIso) {
    if (failures > 0) { failures -= 1; throw Object.assign(new Error("connection reset with learner text 13800138000"), { code: "ECONNRESET" }); }
    return repository.applyRetention(updates, atIso);
  } }) });
  await h.repository.insertAssist(row(200));
  const first = await h.job.runScheduled();
  assert.deepEqual([first.outcome, first.run?.status, first.run?.errorCode, first.run?.attempts], ["ran", "failed", "ECONNRESET", 1]);
  assert.doesNotMatch(JSON.stringify(h.logs), /connection reset|13800138000/, "the error code only, never its message");
  const second = await h.job.runScheduled();
  assert.deepEqual([second.run?.status, second.run?.attempts], ["failed", 2]);
  assert.equal(second.run?.id, first.run?.id, "the same run row for the day");
  const third = await h.job.runScheduled();
  assert.deepEqual([third.run?.status, third.run?.attempts, third.run?.rowsScrubbed, third.run?.errorCode], ["succeeded", 3, 1, null]);
  // Three failures in a day: no fourth attempt until tomorrow.
  failures = 5;
  const h2 = harness({ wrap: (repository) => ({ ...repository, async applyRetention() { if (failures > 0) { failures -= 1; throw new Error("down"); } return 0; } }) });
  await h2.repository.insertAssist(row(200));
  for (let attempt = 0; attempt < 3; attempt += 1) assert.equal((await h2.job.runScheduled()).run?.status, "failed");
  assert.equal((await h2.job.runScheduled()).outcome, "gave_up");
  assert.equal(failures, 2, "no fourth attempt today");
  // A run row still "running" from a crashed instance (the lock is free again): taken over, not duplicated.
  const h3 = harness();
  await h3.repository.insertAssist(row(200));
  await h3.repository.saveJobRun({ id: randomUUID(), job: "assist_retention", day: "2026-10-30", trigger: "schedule", status: "running", attempts: 1, startedAt: new Date(NOW - 3_600_000).toISOString(), finishedAt: null, cutoff: new Date(NOW - 180 * DAY).toISOString(), rowsScrubbed: 0, moreDue: false, instance: "crashed", requestedBy: null, clientEventId: null, errorCode: null });
  const taken = await h3.job.runScheduled();
  assert.deepEqual([taken.run?.status, taken.run?.attempts, taken.run?.instance, taken.run?.rowsScrubbed], ["succeeded", 2, "test-instance", 1]);
  assert.equal((await h3.job.listRuns()).runs.length, 1);
});

test("a run is bounded (batches of the configured size, a few batches); what is left is done by the next run", async () => {
  const h = harness({ rules: { batchSize: 2, maxBatches: 2 } });
  for (let index = 0; index < 5; index += 1) await h.repository.insertAssist(row(200 + index));
  const first = await h.job.runScheduled();
  assert.deepEqual([first.run?.rowsScrubbed, first.run?.moreDue], [4, true]);
  const manual = await h.job.runManual(agent, randomUUID());
  assert.deepEqual([manual.outcome, manual.run?.rowsScrubbed, manual.run?.moreDue], ["completed", 1, false]);
});

test("a scheduled run that stopped at its bound is continued by the next tick the same day (on the same row) until nothing is left; then the day is done", async () => {
  const h = harness({ rules: { batchSize: 2, maxBatches: 2 } });
  for (let index = 0; index < 9; index += 1) await h.repository.insertAssist(row(200 + index));
  const first = await h.job.runScheduled();
  assert.deepEqual([first.outcome, first.run?.rowsScrubbed, first.run?.moreDue], ["ran", 4, true]);
  h.advance(30 * 60_000);
  const second = await h.job.runScheduled();
  assert.deepEqual([second.outcome, second.run?.id, second.run?.rowsScrubbed, second.run?.moreDue, second.run?.attempts], ["ran", first.run?.id, 8, true, 1]);
  h.advance(30 * 60_000);
  const third = await h.job.runScheduled();
  assert.deepEqual([third.outcome, third.run?.id, third.run?.rowsScrubbed, third.run?.moreDue, third.run?.status], ["ran", first.run?.id, 9, false, "succeeded"]);
  h.advance(30 * 60_000);
  const fourth = await h.job.runScheduled();
  assert.deepEqual([fourth.outcome, fourth.run?.rowsScrubbed], ["done_today", 9]);
  const runs = await h.job.listRuns();
  assert.equal(runs.runs.length, 1);
  assert.deepEqual(h.logs.filter((line) => line.event === "job_run").map((line) => [line.rowsScrubbed, line.moreDue]), [[4, true], [8, true], [9, false]]);
});

test("run now (staff): idempotent by Idempotency-Key, recorded with who asked, allowed after today's scheduled run; a key reused by someone else is a conflict", async () => {
  const h = harness();
  await h.repository.insertAssist(row(200));
  await h.job.runScheduled();
  await h.repository.insertAssist(row(300));
  const key = randomUUID();
  const first = await h.job.runManual(agent, key);
  assert.equal(first.outcome, "completed");
  assert.deepEqual([first.run?.trigger, first.run?.status, first.run?.rowsScrubbed, first.run?.requestedBy], ["manual", "succeeded", 1, agent]);
  await h.repository.insertAssist(row(400));
  const replay = await h.job.runManual(agent, key);
  assert.deepEqual(replay, first, "the same key answers with the same run and does not run again");
  await assert.rejects(h.job.runManual({ id: "emp-9", name: "Someone Else" }, key), (error: unknown) => error instanceof HelpdeskProblem && error.code === "idempotency_conflict");
  const runs = (await h.job.listRuns()).runs;
  assert.deepEqual(runs.map((run) => run.trigger).sort(), ["manual", "schedule"]);
  assert.ok(h.logs.some((line) => line.event === "job_run" && line.trigger === "manual" && line.requestedBy === agent.id));
  // The view the integration API returns: no instance name, no key.
  assert.deepEqual(Object.keys(first.run!).sort(), ["attempts", "cutoff", "day", "errorCode", "finishedAt", "id", "job", "moreDue", "requestedBy", "rowsScrubbed", "startedAt", "status", "trigger"]);
});

test("scrubForRetention is pure and keeps the column limits (question 1-500 characters)", () => {
  const update = scrubForRetention({ id: "x", learnerId: learner.id, question: `${"电话 13800138000 ".repeat(60)}`, answer: null, kind: "no_match", texts: null, contacts: { names: [], emails: [] } }, undefined);
  assert.ok([...update.question].length <= 500);
  assert.ok(!update.question.includes("13800138000"));
  assert.equal(scrubForRetention({ id: "x", learnerId: "u", question: "​", answer: null, kind: null, texts: null, contacts: { names: [], emails: [] } }, undefined).question, "-");
});

test("the in-process loop: first tick after a delay (startup is never blocked), then on the interval, never two ticks at once, a failing tick is swallowed, stop clears it", async () => {
  const pending: Array<{ fn: () => void; ms: number; id: number }> = [];
  let ids = 0;
  const timers = { setTimeout: (fn: () => void, ms: number) => { const entry = { fn, ms, id: ids += 1 }; pending.push(entry); return entry.id; }, clearTimeout: (handle: unknown) => { const at = pending.findIndex((entry) => entry.id === handle); if (at >= 0) pending.splice(at, 1); } };
  let ticks = 0;
  let release: () => void = () => undefined;
  const loop = startJobLoop({ name: "assist_retention", firstDelayMs: 120_000, intervalMs: 1_800_000, timers, log: () => undefined, tick: async () => { ticks += 1; if (ticks === 2) throw new Error("boom"); if (ticks === 3) await new Promise<void>((resolve) => { release = resolve; }); } });
  assert.equal(ticks, 0, "nothing runs during start");
  assert.deepEqual(pending.map((entry) => entry.ms), [120_000]);
  const fire = async () => { const entry = pending.shift()!; entry.fn(); await new Promise((resolve) => setImmediate(resolve)); };
  await fire();
  assert.equal(ticks, 1);
  assert.deepEqual(pending.map((entry) => entry.ms), [1_800_000], "the next tick is scheduled after this one finished");
  await fire();
  assert.equal(ticks, 2, "a throwing tick does not stop the loop");
  assert.equal(pending.length, 1);
  await fire();
  assert.equal(ticks, 3);
  assert.equal(pending.length, 0, "while a tick runs, no other is scheduled");
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 1);
  loop.stop();
  assert.equal(pending.length, 0);
});

test("the server start: register() starts the loop once per process on the Node.js runtime only, never blocking; without PostgreSQL it only logs", async () => {
  const env = { ...process.env };
  const flag = globalThis as typeof globalThis & { __lgHelpdeskJobsStarted?: boolean };
  const { startHelpdeskBackgroundJobs, HELPDESK_JOB_LOOP } = await import("../../modules/helpdesk/runtime");
  try {
    delete flag.__lgHelpdeskJobsStarted;
    process.env.STORAGE_BACKEND = "local";
    const logs: Array<Record<string, unknown>> = [];
    assert.equal(startHelpdeskBackgroundJobs({ log: (line) => logs.push(line) }), null);
    assert.deepEqual(logs, [{ type: "helpdesk", event: "jobs_not_started", reason: "no_database" }]);

    delete flag.__lgHelpdeskJobsStarted;
    delete process.env.STORAGE_BACKEND;
    process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/none";
    process.env.DATA_S3_BUCKET = "unused-in-this-test";
    const scheduled: number[] = [];
    let cleared = 0;
    const timers = { setTimeout(_fn: () => void, ms: number) { scheduled.push(ms); return scheduled.length; }, clearTimeout() { cleared += 1; } };
    const started: Array<Record<string, unknown>> = [];
    const loop = startHelpdeskBackgroundJobs({ log: (line) => started.push(line), timers, random: () => 0.5 });
    assert.ok(loop, "with PostgreSQL the loop starts");
    assert.deepEqual(scheduled, [HELPDESK_JOB_LOOP.firstDelayMs + HELPDESK_JOB_LOOP.jitterMs / 2], "only a timer: no database call while the server starts");
    assert.equal(started[0].event, "jobs_started");
    assert.equal(startHelpdeskBackgroundJobs({ timers }), null, "a second call in the same process does nothing");
    assert.deepEqual(scheduled.length, 1);
    loop.stop();
    assert.equal(cleared, 1);

    // instrumentation.ts: the edge runtime never imports the jobs.
    delete flag.__lgHelpdeskJobsStarted;
    const { register } = await import("../../instrumentation");
    process.env.NEXT_RUNTIME = "edge";
    await register();
    assert.equal(flag.__lgHelpdeskJobsStarted, undefined);
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.STORAGE_BACKEND = "local";
    await register();
    assert.equal(flag.__lgHelpdeskJobsStarted, true);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    delete flag.__lgHelpdeskJobsStarted;
  }
});

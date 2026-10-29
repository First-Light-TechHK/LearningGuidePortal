// Helpdesk v5 Part G1 (helpdesk-v5-context-chips-and-smalltalk.md): raw
// learner text in the assist log is kept 180 days; after that only the
// scrubbed text (modules/helpdesk/piiScrubber.ts) and the labels stay.
// What is replaced on a row older than the cutoff: the question (what the
// learner typed, the chip label or the enquiry subject), the short strings
// shown with the card (texts), and a clarify's explanation (its answer
// column). An FAQ answer is Admin's approved text and stays as it is; enum
// labels, ids, votes, ratings and times are never touched.
// The job (helpdesk_job_runs, migration 024):
// - one holder at a time across instances (repository.withJobLock: a
//   PostgreSQL session advisory lock), so two instances never run it at once;
// - at most one scheduled run per UTC day: a run row; a failed run is retried
//   by a later tick on the same row, at most three attempts a day; a row left
//   "running" by an instance that died is taken over (the lock proves it is
//   not running any more);
// - bounded: batches of 200 rows, at most 50 batches a run; what is left is
//   done by the next run (moreDue says so);
// - observable: the run row and one structured log line per run (counts,
//   status, error code; never text);
// - staff "run now" (POST .../jobs/assist-retention/run): idempotent by its
//   Idempotency-Key, recorded with the staff member BackOffice checked.
import { hostname } from "node:os";
import {
  ASSIST_RETENTION_DAYS, HelpdeskProblem,
  type AgentIdentity, type HelpdeskJobRun, type JobRunResponse, type JobRunsResponse
} from "@/contracts/helpdesk";
import { uuidv7 } from "@/lib/uuidv7";
import { scrubContextOf, type AccountDirectory, type LearnerAccount } from "./insights";
import { scrubPii } from "./piiScrubber";
import type { AssistTexts, HelpdeskRepository, JobRunRecord, RetentionRow, RetentionUpdate } from "./repository";

const JOB = "assist_retention" as const;
const DAY_MS = 86_400_000;

export const RETENTION_RULES = { days: ASSIST_RETENTION_DAYS, batchSize: 200, maxBatches: 50, maxAttempts: 3 } as const;
export type RetentionRules = { days: number; batchSize: number; maxBatches: number; maxAttempts: number };

const QUESTION_MAX = 500;
const clip = (text: string, max: number) => [...text].slice(0, max).join("");

/** The scrubbed replacement of one row (pure). The question column needs 1-500 characters: an empty result becomes "-". */
export function scrubForRetention(row: RetentionRow, account: LearnerAccount | undefined): RetentionUpdate {
  const context = scrubContextOf(account, row.contacts);
  const scrub = (text: string | null) => (text === null ? null : scrubPii(text, context));
  const texts: AssistTexts | null = row.texts ? { ...row.texts, opening: scrub(row.texts.opening), closing: scrub(row.texts.closing), reply: scrub(row.texts.reply), explanation: scrub(row.texts.explanation) } : null;
  const question = clip(scrubPii(row.question, context), QUESTION_MAX).trim();
  return { id: row.id, question: question || "-", answer: row.kind === "clarify" ? scrub(row.answer) : row.answer, texts };
}

/** What the integration API shows of a run (no instance name, no Idempotency-Key). */
export function jobRunView(record: JobRunRecord): HelpdeskJobRun {
  return {
    id: record.id, job: record.job, day: record.day, trigger: record.trigger, status: record.status, attempts: record.attempts, startedAt: record.startedAt,
    finishedAt: record.finishedAt, cutoff: record.cutoff, rowsScrubbed: record.rowsScrubbed, moreDue: record.moreDue, requestedBy: record.requestedBy, errorCode: record.errorCode
  };
}

/** A short, safe code for the run row and the log: the error's code (SQLSTATE, Node / AWS code) or its class name, never its message. */
function errorCodeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(code)) return code;
  return error instanceof Error ? error.name.slice(0, 64) : "unknown";
}

export type RetentionDeps = {
  repository: Pick<HelpdeskRepository, "listRetentionDue" | "applyRetention" | "withJobLock" | "findScheduledRun" | "findJobRunByKey" | "saveJobRun" | "listJobRuns">;
  accounts: AccountDirectory;
  now?: () => Date;
  log?: (line: Record<string, unknown>) => void;
  instance?: string;
  rules?: Partial<RetentionRules>;
};

export function createRetentionJob(deps: RetentionDeps) {
  const repository = deps.repository;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: Record<string, unknown>) => console.info(JSON.stringify(line)));
  const instance = (deps.instance ?? `${hostname()}:${process.pid}`).slice(0, 120);
  const rules: RetentionRules = { ...RETENTION_RULES, ...deps.rules };

  const dayOf = (at: Date) => at.toISOString().slice(0, 10);
  const cutoffAt = (at: Date) => new Date(at.getTime() - rules.days * DAY_MS).toISOString();

  /** Runs the batches of one run and records the result on its row (also when it fails). */
  async function execute(start: JobRunRecord): Promise<JobRunRecord> {
    let run = start;
    const started = Date.now();
    await repository.saveJobRun(run);
    try {
      let more = false;
      for (let batch = 0; batch < rules.maxBatches; batch += 1) {
        const due = await repository.listRetentionDue(run.cutoff, rules.batchSize);
        if (due.length === 0) { more = false; break; }
        const accounts = await deps.accounts([...new Set(due.map((row) => row.learnerId))]);
        const changed = await repository.applyRetention(due.map((row) => scrubForRetention(row, accounts.get(row.learnerId))), now().toISOString());
        more = due.length === rules.batchSize;
        run = { ...run, rowsScrubbed: run.rowsScrubbed + changed };
        await repository.saveJobRun(run);
        if (!more) break;
      }
      run = { ...run, status: "succeeded", finishedAt: now().toISOString(), moreDue: more, errorCode: null };
    } catch (error) {
      run = { ...run, status: "failed", finishedAt: now().toISOString(), errorCode: errorCodeOf(error) };
    }
    await repository.saveJobRun(run);
    log({
      type: "helpdesk", event: "job_run", job: run.job, trigger: run.trigger, runId: run.id, day: run.day, status: run.status, attempts: run.attempts,
      rowsScrubbed: run.rowsScrubbed, moreDue: run.moreDue, durationMs: Date.now() - started, instance,
      ...(run.errorCode ? { errorCode: run.errorCode } : {}), ...(run.requestedBy ? { requestedBy: run.requestedBy.id } : {})
    });
    return run;
  }

  function fresh(trigger: JobRunRecord["trigger"], at: Date, extra: Partial<JobRunRecord> = {}): JobRunRecord {
    return {
      id: uuidv7(at.getTime()), job: JOB, day: dayOf(at), trigger, status: "running", attempts: 1, startedAt: at.toISOString(), finishedAt: null, cutoff: cutoffAt(at),
      rowsScrubbed: 0, moreDue: false, instance, requestedBy: null, clientEventId: null, errorCode: null, ...extra
    };
  }

  /** The daily tick (every instance calls it; the lock and the day's run row make it run once). */
  async function runScheduled(): Promise<{ outcome: "ran" | "done_today" | "locked" | "gave_up"; run: JobRunRecord | null }> {
    const result = await repository.withJobLock(JOB, async () => {
      const at = now();
      const existing = await repository.findScheduledRun(JOB, dayOf(at));
      if (existing?.status === "succeeded") return { outcome: "done_today" as const, run: existing };
      if (existing && existing.attempts >= rules.maxAttempts && existing.status === "failed") return { outcome: "gave_up" as const, run: existing };
      // A failed run is retried on its row; one still "running" was left by an instance that died (this one holds the lock now).
      const run = existing
        ? { ...existing, status: "running" as const, attempts: existing.attempts + 1, startedAt: at.toISOString(), finishedAt: null, cutoff: cutoffAt(at), instance, errorCode: null }
        : fresh("schedule", at);
      return { outcome: "ran" as const, run: await execute(run) };
    });
    if (!result.locked) {
      log({ type: "helpdesk", event: "job_skipped", job: JOB, reason: "locked", instance });
      return { outcome: "locked", run: null };
    }
    if (result.value.outcome === "gave_up") log({ type: "helpdesk", event: "job_skipped", job: JOB, reason: "gave_up", day: result.value.run?.day, instance });
    return result.value;
  }

  function sameRequest(run: JobRunRecord, agent: AgentIdentity): JobRunResponse {
    if (run.requestedBy?.id !== agent.id) throw new HelpdeskProblem("idempotency_conflict", "This Idempotency-Key was already used for a different request.");
    return { outcome: "completed", run: jobRunView(run) };
  }

  /** Staff "run now": runs at once (bounded like a scheduled run); the same key answers with the same run. */
  async function runManual(agent: AgentIdentity, key: string): Promise<JobRunResponse> {
    const earlier = await repository.findJobRunByKey(key);
    if (earlier) return sameRequest(earlier, agent);
    const result = await repository.withJobLock(JOB, async () => {
      const raced = await repository.findJobRunByKey(key);
      if (raced) return sameRequest(raced, agent);
      const run = fresh("manual", now(), { requestedBy: agent, clientEventId: key });
      if ((await repository.saveJobRun(run)) === "duplicate") {
        const stored = await repository.findJobRunByKey(key);
        if (stored) return sameRequest(stored, agent);
      }
      return { outcome: "completed" as const, run: jobRunView(await execute(run)) };
    });
    if (!result.locked) return { outcome: "already_running", run: null };
    return result.value;
  }

  async function listRuns(limit = 20): Promise<JobRunsResponse> {
    return { job: JOB, retentionDays: rules.days, runs: (await repository.listJobRuns(JOB, limit)).map(jobRunView) };
  }

  return { runScheduled, runManual, listRuns };
}

export type RetentionJob = ReturnType<typeof createRetentionJob>;

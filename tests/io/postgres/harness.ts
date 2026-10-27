// Harness for the PostgreSQL Study Group repository I/O tests (design §4.1).
// Unlike tests/io/harness.ts this helper does NOT isolate to the file store:
// it requires DATABASE_URL (fail-closed, never a silent skip), applies the
// 012 artifact file itself as the schema under test, truncates the Study
// Group tables between tests, and spawns independent worker processes so the
// database — not an in-process lock — arbitrates every race.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { getPool } from "../../../services/persistence/db";
import { createPostgresStudyGroupRepository } from "../../../repositories/studyGroupRepository";
import type { StudyGroupRepository } from "../../../modules/group-study/repository";
import type { SessionStatus } from "../../../modules/group-study/domain";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRODUCT_ROOT = path.resolve(HERE, "../../..");
const MIGRATION_FILE = path.join(PRODUCT_ROOT, "db", "migrations", "012_study_group_persistence.sql");
const WORKER_FILE = path.join(HERE, "workers.ts");
const REGISTER_TS_CONFIG_PATHS = path.join(PRODUCT_ROOT, "scripts", "register-tsconfig-paths.cjs");

export const STUDY_GROUP_TABLES = [
  "study_groups",
  "study_group_memberships",
  "live_sessions",
  "study_group_attendance_intents",
  "study_group_presences",
  "study_group_meetings",
  "study_group_reminders",
  "study_group_tutor_requests",
  "study_group_outbox",
  "study_group_token_log",
  "study_group_webhook_receipts"
];

export const TEST_NOW = "2026-10-11T02:00:00.000Z";

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error([
      "test:io:pg requires DATABASE_URL and never skips silently.",
      "Start a local PostgreSQL and re-run, for example:",
      "  docker run --rm --name lg-study-group-io -e POSTGRES_USER=lg -e POSTGRES_PASSWORD=lg -e POSTGRES_DB=study_group_io -p 15433:5432 postgres:16",
      "  DATABASE_URL=postgres://lg:lg@127.0.0.1:15433/study_group_io DATABASE_SSL=0 npm run test:io:pg",
      "DATABASE_SSL=0 is required for a local container without TLS (postgresSsl, services/persistence/db.ts)."
    ].join("\n"));
  }
  return url;
}

/** Drop any prior Study Group schema, then apply the 012 artifact file itself. */
export async function resetSchema() {
  requireDatabaseUrl();
  const client = await getPool().connect();
  try {
    await client.query(`DROP TABLE IF EXISTS ${STUDY_GROUP_TABLES.join(", ")} CASCADE`);
    await client.query(readFileSync(MIGRATION_FILE, "utf8"));
  } finally {
    client.release();
  }
}

export async function truncateStudyGroupTables() {
  await getPool().query(`TRUNCATE ${STUDY_GROUP_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

export async function closePool() {
  await getPool().end();
}

export function studyGroupRepository(): StudyGroupRepository {
  return createPostgresStudyGroupRepository();
}

export async function rows<T extends Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
  return (await getPool().query(text, params)).rows as T[];
}

export async function countScalar(text: string, params?: unknown[]): Promise<number> {
  const result = await getPool().query(text, params);
  const first = result.rows[0] as Record<string, unknown> | undefined;
  return Number(first ? Object.values(first)[0] ?? 0 : 0);
}

export async function seedGroupAndSession(repository: StudyGroupRepository, input: { sessionId: string; maxParticipants: number; status?: SessionStatus }) {
  const status = input.status ?? "live";
  const groupId = `g-${input.sessionId}`;
  await repository.update((store) => {
    store.groups.push({
      id: groupId,
      title: "Study Group",
      courseId: "course-1",
      about: "Repository-level persistence proof.",
      hostUserId: "host",
      status: "active",
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW
    });
    store.memberships.push({ id: `m-${input.sessionId}`, groupId, userId: "host", role: "host", joinedAt: TEST_NOW, leftAt: null });
    store.sessions.push({
      id: input.sessionId,
      groupId,
      title: "Session",
      relatedLessonId: null,
      startsAt: TEST_NOW,
      durationSeconds: 1800,
      maxParticipants: input.maxParticipants,
      focus: null,
      aiTutorEnabled: true,
      liveKitProjectId: null,
      status,
      startedAt: status === "live" ? TEST_NOW : null,
      completedAt: null,
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW
    });
  });
}

/** Blind seat insert (no capacity check) — used for seeding and for the CHECK backstop test. */
export async function seatUser(repository: StudyGroupRepository, sessionId: string, userId: string) {
  await repository.update((store) => {
    store.presences.push({
      id: randomUUID(),
      sessionId,
      userId,
      requestedAt: `${TEST_NOW}#00000001`,
      enteredAt: TEST_NOW,
      leftAt: null,
      phase: "live"
    });
  });
}

export async function seedTutorRequest(repository: StudyGroupRepository, input: { id: string; sessionId: string; userId?: string; text?: string; receivedAt?: string }) {
  const userId = input.userId ?? "u-1";
  await repository.update((store) => {
    // Only a current member's question is answered (QA 2026-10-27 S4), so the
    // asker is seeded as a member of the session's group.
    const session = store.sessions.find((item) => item.id === input.sessionId);
    if (session && !store.memberships.some((item) => item.groupId === session.groupId && item.userId === userId && !item.leftAt)) {
      store.memberships.push({ id: `m-${session.groupId}-${userId}`, groupId: session.groupId, userId, role: "member", joinedAt: TEST_NOW, leftAt: null });
    }
    store.tutorRequests.push({
      id: input.id,
      sessionId: input.sessionId,
      userId,
      clientEventId: `evt-${input.id}`,
      text: input.text ?? `Question ${input.id}`,
      receivedAt: input.receivedAt ?? TEST_NOW,
      inFlight: false
    });
  });
}

export type WorkerSpec = { mode: string; env?: Record<string, string> };
export type WorkerOutcome = {
  mode: string;
  role: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  result: Record<string, unknown> | null;
  stdout: string;
  stderr: string;
};

function collect(child: ChildProcess, role: string, mode: string, timeoutMs: number): Promise<WorkerOutcome> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.on("exit", (exitCode, signal) => {
      clearTimeout(timer);
      const line = stdout.split("\n").find((item) => item.startsWith("LG_IO_RESULT "));
      let result: Record<string, unknown> | null = null;
      if (line) {
        try {
          result = JSON.parse(line.slice("LG_IO_RESULT ".length)) as Record<string, unknown>;
        } catch {
          result = null;
        }
      }
      resolve({ mode, role, exitCode, signal, result, stdout, stderr });
    });
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Spawn one worker process per spec, wait until every worker has signalled
 * readiness, then release the shared barrier so all workers run their
 * operation at the same time. Each worker holds its own pool, so only the
 * database can arbitrate the race.
 *
 * Options beyond the timeouts are additive and default off, so the Study Group
 * proofs keep their exact behaviour:
 *  - workerFile: spawn this absolute entry file instead of workers.ts.
 *  - perWorkerCwd: give each worker its own tmp working directory (with
 *    data/knowledge_system/learning_guide/) so a local file lock cannot mask
 *    database arbitration; the tsx loader is then referenced by absolute file
 *    URL because a tmp cwd cannot resolve the bare "tsx" specifier.
 */
export async function runWorkers(
  specs: WorkerSpec[],
  options: { timeoutMs?: number; readyTimeoutMs?: number; workerFile?: string; perWorkerCwd?: boolean } = {}
): Promise<WorkerOutcome[]> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const readyTimeoutMs = options.readyTimeoutMs ?? 20_000;
  const workerFile = options.workerFile ?? WORKER_FILE;
  const dir = mkdtempSync(path.join(tmpdir(), "lg-sg-io-"));
  const barrierDir = path.join(dir, "barrier");
  mkdirSync(barrierDir, { recursive: true });
  const workerDirs: string[] = [];
  const children = specs.map((spec, index) => {
    const role = String.fromCharCode(65 + index);
    let cwd = PRODUCT_ROOT;
    let loaderArgs = ["--import", "tsx"];
    if (options.perWorkerCwd) {
      cwd = mkdtempSync(path.join(tmpdir(), "lg-io-cwd-"));
      workerDirs.push(cwd);
      mkdirSync(path.join(cwd, "data", "knowledge_system", "learning_guide"), { recursive: true });
      loaderArgs = ["--import", pathToFileURL(path.join(PRODUCT_ROOT, "node_modules", "tsx", "dist", "loader.mjs")).href];
    }
    const child = spawn(process.execPath, [...loaderArgs, "--require", REGISTER_TS_CONFIG_PATHS, workerFile], {
      cwd,
      env: { ...process.env, LG_IO_MODE: spec.mode, LG_IO_ROLE: role, LG_IO_BARRIER_DIR: barrierDir, ...spec.env }
    });
    return { role, spec, child };
  });
  try {
    const started = Date.now();
    while (!specs.every((_, index) => existsSync(path.join(barrierDir, `${String.fromCharCode(65 + index)}.ready`)))) {
      if (Date.now() - started > readyTimeoutMs) throw new Error(`worker readiness timeout in ${barrierDir}`);
      await sleep(5);
    }
    writeFileSync(path.join(barrierDir, "go"), `${process.pid}\n`);
    const outcomes = await Promise.all(children.map(({ role, spec, child }) => collect(child, role, spec.mode, timeoutMs)));
    for (const outcome of outcomes) {
      if (outcome.exitCode !== 0) {
        throw new Error(`worker ${outcome.role} (${outcome.mode}) failed: exit=${outcome.exitCode} signal=${outcome.signal}\nstdout: ${outcome.stdout}\nstderr: ${outcome.stderr}`);
      }
    }
    return outcomes;
  } finally {
    for (const { child } of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    rmSync(dir, { recursive: true, force: true });
    for (const workerDir of workerDirs) rmSync(workerDir, { recursive: true, force: true });
  }
}

export function workerResult<T = Record<string, unknown>>(outcome: WorkerOutcome): T {
  if (!outcome.result) throw new Error(`worker ${outcome.role} (${outcome.mode}) produced no LG_IO_RESULT line\nstdout: ${outcome.stdout}\nstderr: ${outcome.stderr}`);
  return outcome.result as T;
}

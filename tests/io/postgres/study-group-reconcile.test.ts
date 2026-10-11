// PostgreSQL-level proofs for Study Group reconciliation (slice-2 design §4,
// sweeps A and B): the bounded abandonment of stale webhook receipts, the
// grace-windowed presence repair driven by a provider participant read, the
// containment of a provider failure, and the no-reader no-sweep rule —
// exercised through real service instances built by the workers.ts
// `service-reconcile` mode, each process holding its own pool, so only
// PostgreSQL, the advisory-lock serialization and the repository statements
// can arbitrate.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import {
  closePool,
  countScalar,
  requireDatabaseUrl,
  resetSchema,
  rows,
  runWorkers,
  seedGroupAndSession,
  studyGroupRepository,
  truncateStudyGroupTables,
  workerResult
} from "./harness";

before(async () => {
  requireDatabaseUrl();
  await resetSchema();
});

after(async () => {
  await closePool();
});

beforeEach(async () => {
  await truncateStudyGroupTables();
});

type ReconcileResult = { role: string; abandonedReceipts: number; sessionsChecked: number; presencesClosed: number };
type PresenceState = { id: string; session_id: string; user_id: string; requested_at: string; entered_at: Date | null; left_at: Date | null; phase: string };
type ReceiptState = { receipt_id: string; status: string; failure_class: string | null; received_at: Date; processed_at: Date | null };

/** Run one `service-reconcile` worker; runWorkers fails the test unless it exits 0. */
async function runReconcile(env: Record<string, string> = {}): Promise<ReconcileResult> {
  return workerResult<ReconcileResult>((await runWorkers([{ mode: "service-reconcile", env }]))[0]);
}

async function presenceStates(): Promise<PresenceState[]> {
  return rows<PresenceState>(
    "SELECT id, session_id, user_id, requested_at, entered_at, left_at, phase FROM study_group_presences ORDER BY session_id, user_id"
  );
}

function presenceByUser(states: PresenceState[], sessionId: string, userId: string): PresenceState {
  const row = states.find((item) => item.session_id === sessionId && item.user_id === userId);
  assert.ok(row, `presence row ${sessionId}/${userId} missing`);
  return row;
}

async function receiptStates(ids: string[]): Promise<ReceiptState[]> {
  return rows<ReceiptState>(
    "SELECT receipt_id, status, failure_class, received_at, processed_at FROM study_group_webhook_receipts WHERE receipt_id = ANY($1::text[]) ORDER BY receipt_id",
    [ids]
  );
}

/** loadStore() reads tables without ORDER BY, so snapshots are compared by id. */
function byId<T extends { id: string }>(rowList: T[]): T[] {
  return [...rowList].sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * The drift state shared by the sweep B tests: one project-assigned live
 * session with four open presences — old entered absent, young entered absent,
 * old waiting (entered_at NULL, age read from the requestedAt receipt string),
 * and old entered listed by the provider read — plus a project-less live
 * session (livekit_project_id NULL) with one old open presence, which the
 * candidate query must never return.
 */
async function seedDriftState(input: {
  driftSession: string;
  nullProjectSession: string;
  users: { old: string; young: string; waiting: string; present: string; nullProject: string };
}) {
  // Ages are relative to the real clock: sweep B compares deps.now() (the
  // workers.ts reconcile mode also runs on the real clock) against these rows.
  const testStartMs = Date.now();
  const oldPresenceAt = new Date(testStartMs - 10 * 60_000).toISOString();
  const youngPresenceAt = new Date(testStartMs - 30_000).toISOString();
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: input.driftSession, maxParticipants: 4, status: "live" });
  await seedGroupAndSession(repository, { sessionId: input.nullProjectSession, maxParticipants: 4, status: "live" });
  await repository.update((store) => {
    const drift = store.sessions.find((item) => item.id === input.driftSession);
    if (!drift) throw new Error("drift session missing");
    drift.liveKitProjectId = "p-eu";
    const openPresence = (sessionId: string, userId: string, enteredAt: string | null, phase: "waiting" | "live", requestedAt: string) => ({
      id: `p-${sessionId}-${userId}`,
      sessionId,
      userId,
      requestedAt: `${requestedAt}#00000001`,
      enteredAt,
      leftAt: null,
      phase
    });
    store.presences.push(
      openPresence(input.driftSession, input.users.old, oldPresenceAt, "live", oldPresenceAt),
      openPresence(input.driftSession, input.users.young, youngPresenceAt, "live", youngPresenceAt),
      openPresence(input.driftSession, input.users.waiting, null, "waiting", oldPresenceAt),
      openPresence(input.driftSession, input.users.present, oldPresenceAt, "live", oldPresenceAt),
      openPresence(input.nullProjectSession, input.users.nullProject, oldPresenceAt, "live", oldPresenceAt)
    );
  });
  return { repository, testStartMs };
}

test("sweep A abandons only the stale received receipt and leaves the young and settled rows untouched", async () => {
  await rows(
    `INSERT INTO study_group_webhook_receipts (receipt_id, event_type, session_id, payload, status, received_at, processed_at) VALUES
       ('e-old-r1', 'participant_left', NULL, '{}'::jsonb, 'received', NOW() - INTERVAL '600 seconds', NULL),
       ('e-young-r1', 'participant_left', NULL, '{}'::jsonb, 'received', NOW() - INTERVAL '30 seconds', NULL),
       ('e-settled-r1', 'participant_left', NULL, '{}'::jsonb, 'processed', NOW() - INTERVAL '600 seconds', NOW() - INTERVAL '600 seconds')`
  );
  const untouchedBefore = await receiptStates(["e-young-r1", "e-settled-r1"]);

  // The worker attaches the participant reader, but it reports nothing and no
  // live session exists, so sweep B has no candidate.
  const result = await runReconcile({ LG_IO_PRESENT: "" });

  assert.equal(result.abandonedReceipts, 1, "exactly the stale received receipt is abandoned");
  assert.equal(result.sessionsChecked, 0, "no live session is a sweep B candidate");
  assert.equal(result.presencesClosed, 0);
  const abandoned = (await receiptStates(["e-old-r1"]))[0];
  assert.equal(abandoned.status, "failed");
  assert.equal(abandoned.failure_class, "abandoned");
  assert.notEqual(abandoned.processed_at, null, "the abandoned receipt is stamped processed_at");
  assert.deepEqual(
    await receiptStates(["e-young-r1", "e-settled-r1"]),
    untouchedBefore,
    "the young received receipt and the settled processed receipt are byte-identical"
  );
  assert.equal(await countScalar("SELECT count(*) FROM study_group_webhook_receipts"), 3, "no receipt row is added or removed");
});

test("sweep B closes only the stale absent presences of a project-assigned live session", async () => {
  const users = { old: "u-2", young: "u-3", waiting: "u-4", present: "u-9", nullProject: "u-5" };
  const { repository, testStartMs } = await seedDriftState({
    driftSession: "s-drift-r2",
    nullProjectSession: "s-null-project-r2",
    users
  });
  const before = await presenceStates();
  const storeBefore = await repository.read();
  const nullProjectSessionBefore = (await rows<Record<string, unknown>>("SELECT * FROM live_sessions WHERE id = 's-null-project-r2'"))[0];

  const result = await runReconcile({ LG_IO_PRESENT: users.present });

  assert.equal(result.abandonedReceipts, 0, "sweep A finds no stale receipt");
  assert.equal(result.sessionsChecked, 1, "only the project-assigned session with open presences is a candidate");
  assert.equal(result.presencesClosed, 2, "the old entered absence and the old waiting row close");

  const after = await presenceStates();
  assert.equal(after.length, before.length, "reconciliation never inserts or removes presence rows");
  for (const userId of [users.old, users.waiting]) {
    const closed = presenceByUser(after, "s-drift-r2", userId);
    const original = presenceByUser(before, "s-drift-r2", userId);
    assert.ok(closed.left_at, `${userId} is closed`);
    assert.ok(closed.left_at.getTime() >= testStartMs, `${userId} is stamped with the run's now`);
    assert.ok(closed.left_at.getTime() <= Date.now(), `${userId} is not stamped in the future`);
    assert.deepEqual({ ...closed, left_at: original.left_at }, original, `${userId} is byte-identical apart from left_at`);
  }
  assert.deepEqual(
    presenceByUser(after, "s-drift-r2", users.young),
    presenceByUser(before, "s-drift-r2", users.young),
    "the young absence is inside the grace window and stays open"
  );
  assert.deepEqual(
    presenceByUser(after, "s-drift-r2", users.present),
    presenceByUser(before, "s-drift-r2", users.present),
    "the provider-listed participant stays open"
  );
  assert.deepEqual(
    presenceByUser(after, "s-null-project-r2", users.nullProject),
    presenceByUser(before, "s-null-project-r2", users.nullProject),
    "the project-less session is not a sweep B candidate"
  );

  const storeAfter = await repository.read();
  assert.deepEqual(
    { groups: byId(storeAfter.groups), memberships: byId(storeAfter.memberships), sessions: byId(storeAfter.sessions), meetings: byId(storeAfter.meetings) },
    { groups: byId(storeBefore.groups), memberships: byId(storeBefore.memberships), sessions: byId(storeBefore.sessions), meetings: byId(storeBefore.meetings) },
    "groups, memberships, sessions and meetings are unchanged"
  );
  assert.deepEqual(
    (await rows<Record<string, unknown>>("SELECT * FROM live_sessions WHERE id = 's-null-project-r2'"))[0],
    nullProjectSessionBefore,
    "the project-less session row is byte-identical"
  );
  assert.equal(await countScalar("SELECT occupancy FROM live_sessions WHERE id = 's-drift-r2'"), 2, "the derived occupancy follows the closed presences");
});

test("a provider failure on one room is contained while the other room still repairs", async () => {
  const testStartMs = Date.now();
  const presenceAt = new Date(testStartMs - 10 * 60_000).toISOString();
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-ok-r3", maxParticipants: 4, status: "live" });
  await seedGroupAndSession(repository, { sessionId: "s-fail-r3", maxParticipants: 4, status: "live" });
  await repository.update((store) => {
    const readable = store.sessions.find((item) => item.id === "s-ok-r3");
    const failing = store.sessions.find((item) => item.id === "s-fail-r3");
    if (!readable || !failing) throw new Error("session missing");
    readable.liveKitProjectId = "p-eu";
    failing.liveKitProjectId = "p-us";
    store.presences.push(
      { id: "p-s-ok-r3-u-2", sessionId: "s-ok-r3", userId: "u-2", requestedAt: `${presenceAt}#00000001`, enteredAt: presenceAt, leftAt: null, phase: "live" },
      { id: "p-s-fail-r3-u-3", sessionId: "s-fail-r3", userId: "u-3", requestedAt: `${presenceAt}#00000001`, enteredAt: presenceAt, leftAt: null, phase: "live" }
    );
  });
  const failingBefore = presenceByUser(await presenceStates(), "s-fail-r3", "u-3");

  // runWorkers fails the test unless the worker exits 0, so reaching these
  // assertions already proves the rate_limited room did not crash the tick.
  const result = await runReconcile({ LG_IO_PRESENT: "", LG_IO_FAIL_ROOM: "s-fail-r3" });

  assert.equal(result.abandonedReceipts, 0);
  assert.equal(result.sessionsChecked, 2, "the rate-limited room is still counted as checked");
  assert.equal(result.presencesClosed, 1, "only the readable room's stale presence closes");
  const readableAfter = presenceByUser(await presenceStates(), "s-ok-r3", "u-2");
  assert.ok(readableAfter.left_at, "the readable room's stale absence is closed");
  assert.ok(readableAfter.left_at.getTime() >= testStartMs, "the close is stamped with the run's now");
  assert.deepEqual(
    presenceByUser(await presenceStates(), "s-fail-r3", "u-3"),
    failingBefore,
    "the rate-limited room's presence stays open for the next tick"
  );
  assert.equal(await countScalar("SELECT count(*) FROM study_group_presences WHERE left_at IS NOT NULL"), 1, "exactly one presence is closed");
});

test("without a provider reader sweep A still runs but sweep B is skipped and every presence is untouched", async () => {
  const users = { old: "u-2", young: "u-3", waiting: "u-4", present: "u-9", nullProject: "u-5" };
  const { repository } = await seedDriftState({
    driftSession: "s-drift-r4",
    nullProjectSession: "s-null-project-r4",
    users
  });
  await rows(
    "INSERT INTO study_group_webhook_receipts (receipt_id, event_type, session_id, payload, status, received_at) VALUES ($1, $2, $3, $4::jsonb, 'received', NOW() - INTERVAL '600 seconds')",
    ["e-old-r4", "participant_left", "s-drift-r4", "{}"]
  );
  const before = await presenceStates();
  const storeBefore = await repository.read();

  // Neither LG_IO_PRESENT nor LG_IO_FAIL_ROOM is set: the fixture has no
  // listParticipants member, so sweep B must be skipped, never guessed.
  const result = await runReconcile();

  assert.equal(result.abandonedReceipts, 1, "sweep A still abandons the stale receipt without a reader");
  assert.equal(result.sessionsChecked, 0, "no session is checked without a provider read");
  assert.equal(result.presencesClosed, 0, "no presence is closed without a provider read");
  assert.equal(
    await countScalar("SELECT count(*) FROM study_group_webhook_receipts WHERE receipt_id = 'e-old-r4' AND status = 'failed' AND failure_class = 'abandoned'"),
    1,
    "the stale receipt is abandoned exactly as in sweep A"
  );
  assert.deepEqual(await presenceStates(), before, "every presence row is byte-identical");
  const storeAfter = await repository.read();
  assert.deepEqual(
    { groups: byId(storeAfter.groups), memberships: byId(storeAfter.memberships), sessions: byId(storeAfter.sessions), meetings: byId(storeAfter.meetings), presences: byId(storeAfter.presences) },
    { groups: byId(storeBefore.groups), memberships: byId(storeBefore.memberships), sessions: byId(storeBefore.sessions), meetings: byId(storeBefore.meetings), presences: byId(storeBefore.presences) },
    "no store row changed"
  );
});

// PostgreSQL-level proofs for Study Group reconciliation: the bounded
// abandonment of stale webhook receipts (slice-2 design §4, sweep A) and the
// seat-lease sweep (QA 2026-10-19 redesign, modules/group-study/presence.ts)
// that closes lapsed seats at their lease end, persists the derived occupancy
// and ends live sessions empty past the grace — without ever asking the
// provider — exercised through real service instances built by the workers.ts
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
type PresenceState = { id: string; session_id: string; user_id: string; requested_at: string; entered_at: Date | null; left_at: Date | null; last_seen_at: Date | null; phase: string };
type ReceiptState = { receipt_id: string; status: string; failure_class: string | null; received_at: Date; processed_at: Date | null };

/** Run one `service-reconcile` worker; runWorkers fails the test unless it exits 0. */
async function runReconcile(env: Record<string, string> = {}): Promise<ReconcileResult> {
  return workerResult<ReconcileResult>((await runWorkers([{ mode: "service-reconcile", env }]))[0]);
}

async function presenceStates(): Promise<PresenceState[]> {
  return rows<PresenceState>(
    "SELECT id, session_id, user_id, requested_at, entered_at, left_at, last_seen_at, phase FROM study_group_presences ORDER BY session_id, user_id"
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
 * Two live sessions on the real clock (the reconcile worker runs on it): a
 * "busy" one whose seats are a renewed holder, a holder whose lease ran out a
 * few minutes ago and a waiting row that never entered; and an "abandoned" one
 * whose only seat lapsed long before the grace ran out.
 */
async function seedLeaseState(input: { busy: string; abandoned: string }) {
  const nowMs = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const startedAt = iso(nowMs - 20 * 60_000);
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: input.busy, maxParticipants: 4, status: "live" });
  await seedGroupAndSession(repository, { sessionId: input.abandoned, maxParticipants: 4, status: "live" });
  const lapsedSeenMs = nowMs - 5 * 60_000;
  const abandonedSeenMs = nowMs - 10 * 60_000;
  await repository.update((store) => {
    for (const session of store.sessions) {
      session.startedAt = startedAt;
      session.liveKitProjectId = session.id === input.busy ? "p-eu" : "p-us";
    }
    const seat = (sessionId: string, userId: string, lastSeenMs: number | null, enteredAt: string | null = startedAt) => ({
      id: `p-${sessionId}-${userId}`,
      sessionId,
      userId,
      requestedAt: `${startedAt}#00000001`,
      enteredAt,
      leftAt: null,
      phase: enteredAt ? "live" as const : "waiting" as const,
      lastSeenAt: lastSeenMs === null ? null : iso(lastSeenMs)
    });
    store.presences.push(
      seat(input.busy, "u-renewed", nowMs + 60_000),
      seat(input.busy, "u-lapsed", lapsedSeenMs),
      seat(input.busy, "u-waiting", null, null),
      seat(input.abandoned, "u-gone", abandonedSeenMs)
    );
  });
  return { repository, lapsedAt: lapsedSeenMs + 30_000, abandonedAt: abandonedSeenMs + 30_000 };
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

test("the lease sweep closes lapsed seats at their lease end, keeps renewed seats and ends the abandoned session", async () => {
  const { repository, lapsedAt, abandonedAt } = await seedLeaseState({ busy: "s-busy-r2", abandoned: "s-gone-r2" });
  const before = await presenceStates();
  const storeBefore = await repository.read();

  // A provider reader that would fail for the busy room is attached: the
  // lease sweep must never call it, so the room still reconciles.
  const result = await runReconcile({ LG_IO_PRESENT: "", LG_IO_FAIL_ROOM: "s-busy-r2" });

  assert.equal(result.abandonedReceipts, 0, "sweep A finds no stale receipt");
  assert.equal(result.presencesClosed, 2, "the two lapsed seats close");
  assert.equal(result.sessionsChecked, 1, "the abandoned live session ends");

  const after = await presenceStates();
  assert.equal(after.length, before.length, "reconciliation never inserts or removes presence rows");
  assert.equal(presenceByUser(after, "s-busy-r2", "u-lapsed").left_at?.getTime(), lapsedAt, "closed at its own lease end, not at the sweep");
  assert.equal(presenceByUser(after, "s-gone-r2", "u-gone").left_at?.getTime(), abandonedAt);
  for (const userId of ["u-renewed", "u-waiting"]) {
    assert.deepEqual(presenceByUser(after, "s-busy-r2", userId), presenceByUser(before, "s-busy-r2", userId), `${userId} is byte-identical`);
  }
  assert.ok(presenceByUser(after, "s-busy-r2", "u-renewed").last_seen_at, "last_seen_at round-trips through PostgreSQL");
  assert.equal(await countScalar("SELECT occupancy FROM live_sessions WHERE id = 's-busy-r2'"), 1, "the stored occupancy counts only the held seat");

  const ended = (await rows<{ status: string; completed_at: Date | null }>("SELECT status, completed_at FROM live_sessions WHERE id = 's-gone-r2'"))[0];
  assert.equal(ended.status, "completed");
  assert.equal(ended.completed_at?.getTime(), abandonedAt, "the session ends dated to when it emptied");
  assert.equal(await countScalar("SELECT status = 'live' FROM live_sessions WHERE id = 's-busy-r2'"), 1);
  const storeAfter = await repository.read();
  assert.deepEqual(
    { groups: byId(storeAfter.groups), memberships: byId(storeAfter.memberships) },
    { groups: byId(storeBefore.groups), memberships: byId(storeBefore.memberships) },
    "groups and memberships are unchanged"
  );
});

test("the heartbeat fast path renews only a still-held seat of a scheduled or live session", async () => {
  const { repository } = await seedLeaseState({ busy: "s-busy-r4", abandoned: "s-gone-r4" });
  const nowMs = Date.now();
  const at = new Date(nowMs).toISOString();
  const heldSince = new Date(nowMs - 30_000).toISOString();
  const startsBy = new Date(nowMs + 10 * 60_000).toISOString();
  await repository.update((store) => {
    const gone = store.sessions.find((session) => session.id === "s-gone-r4");
    if (gone) gone.status = "completed";
    const held = store.presences.find((row) => row.sessionId === "s-gone-r4" && row.userId === "u-gone");
    if (held) held.lastSeenAt = new Date(nowMs).toISOString();
  });
  const before = await presenceStates();

  assert.equal(await repository.renewSeat({ sessionId: "s-busy-r4", userId: "u-renewed", at, heldSince, startsBy }), true, "a held seat renews");
  assert.equal(await repository.renewSeat({ sessionId: "s-busy-r4", userId: "u-lapsed", at, heldSince, startsBy }), false, "a lapsed seat must enter again");
  assert.equal(await repository.renewSeat({ sessionId: "s-busy-r4", userId: "u-waiting", at, heldSince, startsBy }), false, "a waiting row holds no seat");
  assert.equal(await repository.renewSeat({ sessionId: "s-gone-r4", userId: "u-gone", at, heldSince, startsBy }), false, "an ended session renews nothing");

  const after = await presenceStates();
  assert.equal(presenceByUser(after, "s-busy-r4", "u-renewed").last_seen_at?.getTime(), nowMs);
  for (const [sessionId, userId] of [["s-busy-r4", "u-lapsed"], ["s-busy-r4", "u-waiting"], ["s-gone-r4", "u-gone"]]) {
    assert.deepEqual(presenceByUser(after, sessionId, userId), presenceByUser(before, sessionId, userId), `${userId} is untouched`);
  }
});

// QA final review X-3: before the sweep ends an abandoned room it asks the
// provider; a room a member of its Study Group is still in stays live, and a
// failed read ends it as before. Only members count (r3 server 3).
test("the sweep keeps a room the provider still sees occupied and ends it once the provider cannot say", async () => {
  await seedLeaseState({ busy: "s-busy-x3", abandoned: "s-gone-x3" });
  const kept = await runReconcile({ LG_IO_PRESENT: "host" });
  assert.equal(kept.sessionsChecked, 0, "the occupied room is not ended");
  assert.equal(kept.presencesClosed, 2, "lapsed seats still close");
  assert.equal(await countScalar("SELECT count(*) FROM live_sessions WHERE id = 's-gone-x3' AND status = 'live'"), 1);

  const failed = await runReconcile({ LG_IO_PRESENT: "host", LG_IO_FAIL_ROOM: "s-gone-x3" });
  assert.equal(failed.sessionsChecked, 1, "a failed provider read falls back to the lease rule");
  assert.equal(await countScalar("SELECT count(*) FROM live_sessions WHERE id = 's-gone-x3' AND status = 'completed'"), 1);
});

test("r3 server 3: someone in the room who is not a member of its Study Group does not keep it alive", async () => {
  await seedLeaseState({ busy: "s-busy-x3s", abandoned: "s-gone-x3s" });
  // u-gone held the seat but is not (or no longer) a member of the group.
  const swept = await runReconcile({ LG_IO_PRESENT: "u-gone" });
  assert.equal(swept.sessionsChecked, 1);
  assert.equal(await countScalar("SELECT count(*) FROM live_sessions WHERE id = 's-gone-x3s' AND status = 'completed'"), 1);
});

// QA final review B6 / X-2: a scheduled session's seat renews only in
// Starting Soon (start at or before startsBy) and before its planned end.
test("the heartbeat fast path never renews a seat of a session that is not open for seats", async () => {
  const repository = studyGroupRepository();
  const nowMs = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const cases = [
    { sessionId: "s-soon-b6", startsAt: iso(nowMs + 5 * 60_000), renews: true },
    { sessionId: "s-later-x2", startsAt: iso(nowMs + 2 * 60 * 60_000), renews: false },
    { sessionId: "s-past-b6", startsAt: iso(nowMs - 31 * 60_000), renews: false },
    { sessionId: "s-late-b6", startsAt: iso(nowMs - 29 * 60_000), renews: true }
  ];
  for (const item of cases) await seedGroupAndSession(repository, { sessionId: item.sessionId, maxParticipants: 4, status: "scheduled" });
  await repository.update((store) => {
    for (const item of cases) {
      const session = store.sessions.find((row) => row.id === item.sessionId);
      if (session) session.startsAt = item.startsAt;
      store.presences.push({ id: `p-${item.sessionId}`, sessionId: item.sessionId, userId: "u-wait", requestedAt: `${iso(nowMs)}#00000001`, enteredAt: iso(nowMs - 5_000), leftAt: null, phase: "waiting", lastSeenAt: iso(nowMs - 5_000) });
    }
  });
  const at = iso(nowMs);
  for (const item of cases) {
    const renewed = await repository.renewSeat({ sessionId: item.sessionId, userId: "u-wait", at, heldSince: iso(nowMs - 30_000), startsBy: iso(nowMs + 10 * 60_000) });
    assert.equal(renewed, item.renews, item.sessionId);
    const seen = (await rows<{ last_seen_at: Date }>("SELECT last_seen_at FROM study_group_presences WHERE session_id = $1", [item.sessionId]))[0].last_seen_at.getTime();
    assert.equal(seen, item.renews ? nowMs : nowMs - 5_000, `${item.sessionId} last_seen_at`);
  }
});

test("two reconcile workers racing close each lapsed seat once and an idle tick writes nothing", async () => {
  await seedLeaseState({ busy: "s-busy-r3", abandoned: "s-gone-r3" });
  const results = (await runWorkers([{ mode: "service-reconcile" }, { mode: "service-reconcile" }])).map((outcome) => workerResult<ReconcileResult>(outcome));

  assert.equal(results.reduce((sum, item) => sum + item.presencesClosed, 0), 2, "each lapsed seat is closed by exactly one worker");
  assert.equal(results.reduce((sum, item) => sum + item.sessionsChecked, 0), 1, "the abandoned session ends once");
  const settled = await presenceStates();

  const idle = await runReconcile();
  assert.deepEqual({ ...idle, role: "" }, { role: "", abandonedReceipts: 0, sessionsChecked: 0, presencesClosed: 0 });
  assert.deepEqual(await presenceStates(), settled, "an idle tick leaves every row byte-identical");
});

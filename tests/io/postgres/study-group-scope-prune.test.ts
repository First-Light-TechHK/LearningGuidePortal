// Persistence review 2026-11-03 (H2 follow-up): the PostgreSQL scoped reads
// (repositories/studyGroupRepository.ts scopeClauses) must select exactly the
// rows the file adapter keeps (modules/group-study/repository.ts, through
// domain.ts scopeStore), scoped updates must persist what a mutation added or
// changed without touching rows outside the scope, concurrent scoped updates
// must serialise under the one write lock, and pruneHistory must remove
// settled history only, bounded, with product history untouched.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { ensureSchema, getPool } from "../../../services/persistence/db";
import { scopeStore, type StudyGroupScope, type StudyGroupStore } from "../../../modules/group-study/domain";
import { createStudyGroupRepository } from "../../../modules/group-study/repository";
import { TEST_NOW, closePool, countScalar, requireDatabaseUrl, resetSchema, rows, seatUser, seedGroupAndSession, seedTutorRequest, studyGroupRepository, truncateStudyGroupTables } from "./harness";

const TABLES: Array<keyof StudyGroupStore> = ["groups", "memberships", "sessions", "intents", "presences", "meetings", "reminders", "tutorRequests", "outbox"];
const SEED = Number(process.env.LG_IO_SEED || "20261103");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Deterministic PRNG (mulberry32): the data is random in shape, the run is repeatable (LG_IO_SEED). */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const idsByTable = (store: StudyGroupStore) => Object.fromEntries(TABLES.map((table) => [table, (store[table] as Array<{ id: string }>).map((row) => row.id).sort()]));

/**
 * Random Study Group history straight into the tables: several groups,
 * sessions in every status, memberships (some left), intents (some
 * cancelled), presences open and closed, waiting and live, meetings,
 * reminders, tutor requests in every status, outbox rows in every status (some
 * referencing a request), token log lines and webhook receipts.
 */
async function seedRandomHistory(seed: number) {
  const random = prng(seed);
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  const chance = (p: number) => random() < p;
  const sample = <T>(items: T[], max: number) => [...items].sort(() => random() - 0.5).slice(0, Math.floor(random() * (max + 1)));
  const users = Array.from({ length: 8 }, (_, index) => `u${index + 1}`);
  const pool = getPool();
  const groups = Array.from({ length: 6 }, (_, index) => ({ id: `g${index + 1}`, host: `h${index + 1}`, status: chance(0.2) ? "cancelled" : "active" }));
  for (const group of groups) {
    await pool.query("INSERT INTO study_groups (id, title, course_id, about, host_user_id, status, created_at, updated_at) VALUES ($1, $1, 'course-1', '', $2, $3, $4, $4)", [group.id, group.host, group.status, TEST_NOW]);
    await pool.query("INSERT INTO study_group_memberships (id, group_id, user_id, role, joined_at, left_at) VALUES ($1, $2, $3, 'host', $4, NULL)", [`m-${group.id}-host`, group.id, group.host, TEST_NOW]);
    for (const user of sample(users, 5)) {
      await pool.query("INSERT INTO study_group_memberships (id, group_id, user_id, role, joined_at, left_at) VALUES ($1, $2, $3, 'member', $4, $5)", [`m-${group.id}-${user}`, group.id, user, TEST_NOW, chance(0.3) ? TEST_NOW : null]);
    }
  }
  const sessions: string[] = [];
  const statuses = ["scheduled", "live", "completed", "removed"] as const;
  for (let index = 1; index <= 14; index += 1) {
    const id = `s${index}`;
    const status = pick([...statuses]);
    sessions.push(id);
    await pool.query(
      `INSERT INTO live_sessions (id, group_id, title, related_lesson_id, starts_at, duration_seconds, max_participants, focus, ai_tutor_enabled, livekit_project_id, status, occupancy, started_at, completed_at, created_at, updated_at)
       VALUES ($1, $2, $1, NULL, $3, 1800, 6, NULL, true, $4, $5, 0, $6, $7, $3, $3)`,
      [id, pick(groups).id, TEST_NOW, chance(0.5) ? "p-eu" : null, status, status === "scheduled" ? null : TEST_NOW, status === "completed" ? TEST_NOW : null]
    );
    for (const user of sample(users, 4)) {
      await pool.query("INSERT INTO study_group_attendance_intents (id, session_id, user_id, planned_at, cancelled_at) VALUES ($1, $2, $3, $4, $5)", [`i-${id}-${user}`, id, user, TEST_NOW, chance(0.3) ? TEST_NOW : null]);
    }
    let open = 0;
    for (const user of sample(users, 6)) {
      const entered = chance(0.8);
      const left = entered ? chance(0.4) : chance(0.2);
      if (entered && !left) open += 1;
      await pool.query(
        "INSERT INTO study_group_presences (id, session_id, user_id, requested_at, entered_at, left_at, phase, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $5)",
        [`p-${id}-${user}`, id, user, `${TEST_NOW}#00000001`, entered ? TEST_NOW : null, left ? TEST_NOW : null, entered ? "live" : "waiting"]
      );
    }
    await pool.query("UPDATE live_sessions SET occupancy = $2 WHERE id = $1", [id, open]);
    if (chance(0.5)) await pool.query("INSERT INTO study_group_meetings (id, session_id, started_at, ended_at) VALUES ($1, $2, $3, $4)", [`mt-${id}`, id, TEST_NOW, chance(0.5) ? TEST_NOW : null]);
    for (const user of sample(users, 3)) await pool.query("INSERT INTO study_group_reminders (id, session_id, user_id, sent_at) VALUES ($1, $2, $3, $4)", [`r-${id}-${user}`, id, user, TEST_NOW]);
    let inFlight = false;
    for (let n = 0; n < Math.floor(random() * 4); n += 1) {
      let status = pick(["queued", "in_flight", "answered", "dead_letter"]);
      if (status === "in_flight" && inFlight) status = "queued";
      if (status === "in_flight") inFlight = true;
      const requestId = `t-${id}-${n}`;
      await pool.query(
        "INSERT INTO study_group_tutor_requests (id, session_id, user_id, client_event_id, text, received_at, status, answered_at) VALUES ($1, $2, $3, $4, 'q', $5, $6, $7)",
        [requestId, id, pick(users), `e-${requestId}`, TEST_NOW, status, status === "answered" ? TEST_NOW : null]
      );
      if (chance(0.6)) {
        await pool.query(
          "INSERT INTO study_group_outbox (id, kind, dedupe_key, session_id, payload, status, attempts, created_at) VALUES ($1, 'room_message', $2, $3, '{}'::jsonb, $4, 0, $5)",
          [`o-${requestId}`, chance(0.3) ? `${requestId}:unavailable` : requestId, id, pick(["queued", "sending", "delivered", "failed", "dead"]), TEST_NOW]
        );
      }
    }
    if (chance(0.4)) await pool.query("INSERT INTO study_group_outbox (id, kind, dedupe_key, session_id, payload, status, attempts, created_at) VALUES ($1, 'room_message', $1, $2, '{}'::jsonb, 'delivered', 1, $3)", [`o-extra-${id}`, id, TEST_NOW]);
    if (chance(0.5)) await pool.query("INSERT INTO study_group_webhook_receipts (receipt_id, event_type, session_id, payload, status) VALUES ($1, 'room_finished', $2, '{}'::jsonb, $3)", [`w-${id}`, chance(0.8) ? id : null, pick(["received", "processed", "ignored", "failed"])]);
  }
  for (let n = 0; n < 5; n += 1) await pool.query("INSERT INTO study_group_token_log (line) VALUES ($1)", [`line-${n}`]);
  return { groups: groups.map((group) => group.id), sessions, users };
}

async function tableCounts() {
  const names = ["study_groups", "study_group_memberships", "live_sessions", "study_group_attendance_intents", "study_group_presences", "study_group_meetings", "study_group_reminders", "study_group_token_log"];
  const counts: Record<string, number> = {};
  for (const name of names) counts[name] = await countScalar(`SELECT count(*) FROM ${name}`);
  return counts;
}

before(async () => {
  requireDatabaseUrl();
  await resetSchema();
  await ensureSchema();
});

after(async () => {
  await closePool();
});

beforeEach(async () => {
  await truncateStudyGroupTables();
});

test("scope parity: for every scope kind the PostgreSQL scoped read returns the same row ids per table as the file adapter filtering the whole store (randomised history)", async () => {
  const repository = studyGroupRepository();
  const { groups, sessions, users } = await seedRandomHistory(SEED);
  const whole = await repository.read();
  const directory = await mkdtemp(path.join(tmpdir(), "lg-sg-parity-"));
  try {
    await writeFile(path.join(directory, "study-group.json"), JSON.stringify(whole));
    const file = createStudyGroupRepository(directory);
    const scopes: StudyGroupScope[] = [
      ...sessions.map((session) => ({ session })),
      { session: "no-such-session" },
      ...groups.map((group) => ({ group })),
      { group: "no-such-group" },
      ...users.map((seatsOf) => ({ seatsOf })),
      { seatsOf: "nobody" }
    ];
    const wholeIds = idsByTable(whole);
    const narrowed = new Set<string>();
    const populated = new Set<string>();
    for (const scope of scopes) {
      const label = `${JSON.stringify(scope)} (seed ${SEED})`;
      const pg = idsByTable(await repository.read(scope));
      const local = idsByTable(await file.read(scope));
      assert.deepEqual(pg, local, `PostgreSQL scoped read vs file adapter for ${label}`);
      assert.deepEqual(pg, idsByTable(scopeStore(whole, scope)), `PostgreSQL scoped read vs scopeStore(whole) for ${label}`);
      for (const table of TABLES) {
        if (pg[table].length > 0) populated.add(table);
        if (pg[table].length < wholeIds[table].length) narrowed.add(table);
      }
    }
    // The data was rich enough to mean something: every table was both selected and filtered by some scope.
    assert.deepEqual([...populated].sort(), [...TABLES].sort(), "every table had rows inside some scope");
    assert.deepEqual([...narrowed].sort(), [...TABLES].sort(), "every table had rows outside some scope");
    assert.ok(wholeIds.presences.length >= 20 && wholeIds.tutorRequests.length >= 5 && wholeIds.outbox.length >= 3, `enough history to compare (seed ${SEED})`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a scoped update persists every row the mutation added or changed and leaves rows outside the scope exactly as they were", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-a", maxParticipants: 4 });
  await seedGroupAndSession(repository, { sessionId: "s-b", maxParticipants: 4 });
  await seatUser(repository, "s-a", "u-1");
  await seatUser(repository, "s-b", "u-1");
  await seatUser(repository, "s-b", "u-2");
  await seedTutorRequest(repository, { id: "t-a", sessionId: "s-a" });
  await seedTutorRequest(repository, { id: "t-b", sessionId: "s-b" });
  const before = await repository.read();
  await repository.update((store) => {
    assert.deepEqual(store.sessions.map((row) => row.id), ["s-a"]);
    store.groups[0].about = "changed in scope";
    store.sessions[0].title = "renamed";
    store.memberships.push({ id: "m-s-a-u-3", groupId: "g-s-a", userId: "u-3", role: "member", joinedAt: TEST_NOW, leftAt: null });
    store.presences.find((row) => row.userId === "u-1")!.leftAt = TEST_NOW;
    store.presences.push({ id: "p-s-a-u-3", sessionId: "s-a", userId: "u-3", requestedAt: `${TEST_NOW}#00000002`, enteredAt: TEST_NOW, lastSeenAt: TEST_NOW, leftAt: null, phase: "live", liveKitParticipantSid: null });
    store.intents.push({ id: "i-s-a-u-3", sessionId: "s-a", userId: "u-3", plannedAt: TEST_NOW, cancelledAt: null });
    store.meetings.push({ id: "mt-s-a", sessionId: "s-a", startedAt: TEST_NOW, endedAt: null });
    store.reminders.push({ id: "r-s-a-u-3", sessionId: "s-a", userId: "u-3", sentAt: TEST_NOW });
    store.tutorRequests.push({ id: "t-a2", sessionId: "s-a", userId: "u-3", clientEventId: "e-t-a2", text: "q", receivedAt: TEST_NOW, inFlight: false, status: "queued" });
  }, { session: "s-a" });
  const after = await repository.read();
  const only = (store: StudyGroupStore, table: keyof StudyGroupStore, predicate: (row: never) => boolean) => (store[table] as never[]).filter(predicate);
  const outside = (store: StudyGroupStore) => ({
    groups: only(store, "groups", (row: { id: string }) => row.id === "g-s-b"),
    memberships: only(store, "memberships", (row: { groupId: string }) => row.groupId === "g-s-b"),
    sessions: only(store, "sessions", (row: { id: string }) => row.id === "s-b"),
    presences: only(store, "presences", (row: { sessionId: string }) => row.sessionId === "s-b"),
    tutorRequests: only(store, "tutorRequests", (row: { sessionId: string }) => row.sessionId === "s-b")
  });
  assert.deepEqual(outside(after), outside(before), "every row outside the scope is byte-for-byte what it was");
  const beforeIds = idsByTable(before);
  const afterIds = idsByTable(after);
  for (const table of TABLES) for (const id of beforeIds[table]) assert.ok(afterIds[table].includes(id), `${table} ${id} was not dropped`);
  assert.equal(after.groups.find((row) => row.id === "g-s-a")?.about, "changed in scope");
  assert.equal(after.sessions.find((row) => row.id === "s-a")?.title, "renamed");
  assert.ok(after.memberships.some((row) => row.id === "m-s-a-u-3"));
  assert.equal(after.presences.find((row) => row.sessionId === "s-a" && row.userId === "u-1")?.leftAt, TEST_NOW);
  assert.ok(after.presences.some((row) => row.id === "p-s-a-u-3"));
  assert.ok(after.intents.some((row) => row.id === "i-s-a-u-3") && after.meetings.some((row) => row.id === "mt-s-a") && after.reminders.some((row) => row.id === "r-s-a-u-3"));
  assert.ok(after.tutorRequests.some((row) => row.id === "t-a2"));
  assert.equal(await countScalar("SELECT occupancy FROM live_sessions WHERE id = 's-a'"), 1, "u-1 left, u-3 entered");
  assert.equal(await countScalar("SELECT occupancy FROM live_sessions WHERE id = 's-b'"), 2, "the other session's occupancy is untouched");
  assert.equal(await countScalar("SELECT count(*) FROM study_group_token_log") + await countScalar("SELECT count(*) FROM study_group_webhook_receipts"), 0);
});

test("a scoped update that seats someone in a session outside its scope persists the seat and that session's occupancy backstop", async () => {
  // persistDiff recomputes live_sessions.occupancy only for sessions in the
  // loaded snapshot; a presence added for a session the scope did not load
  // must still bring that session's derived occupancy up to date, or the
  // CHECK (occupancy <= max_participants) backstop is bypassed for one write.
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-in", maxParticipants: 4 });
  await seedGroupAndSession(repository, { sessionId: "s-out", maxParticipants: 4 });
  await seatUser(repository, "s-out", "u-1");
  await repository.update((store) => {
    assert.deepEqual(store.sessions.map((row) => row.id), ["s-in"]);
    store.presences.push({ id: "p-out-u-9", sessionId: "s-out", userId: "u-9", requestedAt: `${TEST_NOW}#00000003`, enteredAt: TEST_NOW, lastSeenAt: TEST_NOW, leftAt: null, phase: "live", liveKitParticipantSid: null });
  }, { session: "s-in" });
  assert.equal(await countScalar("SELECT count(*) FROM study_group_presences WHERE session_id = 's-out' AND left_at IS NULL"), 2, "the out-of-scope seat is persisted");
  assert.equal(await countScalar("SELECT occupancy FROM live_sessions WHERE id = 's-out'"), 2, "the out-of-scope session's occupancy follows its seats");
  assert.equal(await countScalar("SELECT occupancy FROM live_sessions WHERE id = 's-in'"), 0);
});

test("concurrent scoped updates on different sessions (and unscoped ones beside them) serialise under the write lock without a lost update", async () => {
  const repository = studyGroupRepository();
  const sessions = ["s-c1", "s-c2", "s-c3", "s-c4"];
  for (const sessionId of sessions) await seedGroupAndSession(repository, { sessionId, maxParticipants: 6 });
  await repository.update((store) => { for (const session of store.sessions) session.title = "0"; });
  const work: Array<Promise<unknown>> = [];
  for (const sessionId of sessions) {
    for (let seat = 1; seat <= 6; seat += 1) {
      work.push(repository.update((store) => {
        assert.deepEqual(store.sessions.map((row) => row.id), [sessionId]);
        store.presences.push({ id: `p-${sessionId}-${seat}`, sessionId, userId: `u-${seat}`, requestedAt: `${TEST_NOW}#0000000${seat}`, enteredAt: TEST_NOW, lastSeenAt: TEST_NOW, leftAt: null, phase: "live", liveKitParticipantSid: null });
      }, { session: sessionId }));
    }
    for (let n = 0; n < 5; n += 1) {
      // A read-modify-write counter on the session row: only serialised writers keep every increment.
      work.push(repository.update((store) => { store.sessions[0].title = String(Number(store.sessions[0].title) + 1); }, { session: sessionId }));
    }
  }
  for (let n = 0; n < 3; n += 1) {
    work.push(repository.update((store) => { for (const group of store.groups) group.about = `${group.about}.`; }));
  }
  const outcomes = await Promise.allSettled(work);
  assert.deepEqual(outcomes.filter((item) => item.status === "rejected").map((item) => String((item as PromiseRejectedResult).reason)), [], "every writer commits");
  for (const sessionId of sessions) {
    assert.equal(await countScalar("SELECT count(*) FROM study_group_presences WHERE session_id = $1 AND left_at IS NULL", [sessionId]), 6, `${sessionId} seats`);
    assert.equal(await countScalar("SELECT occupancy FROM live_sessions WHERE id = $1", [sessionId]), 6, `${sessionId} occupancy`);
    assert.equal((await rows<{ title: string }>("SELECT title FROM live_sessions WHERE id = $1", [sessionId]))[0].title, "5", `${sessionId} counter: no increment lost`);
  }
  assert.equal(await countScalar("SELECT count(*) FROM study_groups WHERE about LIKE '%...'"), 4, "the three unscoped writers each appended once to every group");
});

test("pruneHistory: every edge case by id (just older / just younger than the cutoff, each status, referenced vs unreferenced), product history untouched, nothing references the pruned tables", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-p1", maxParticipants: 4 });
  await seatUser(repository, "s-p1", "u-1");
  await seatUser(repository, "s-p1", "u-2");
  await getPool().query("INSERT INTO study_group_attendance_intents (id, session_id, user_id, planned_at) VALUES ('i-p1', 's-p1', 'u-3', NOW() - INTERVAL '45 days')");
  await getPool().query("INSERT INTO study_group_meetings (id, session_id, started_at, ended_at) VALUES ('mt-p1', 's-p1', NOW() - INTERVAL '45 days', NOW() - INTERVAL '44 days')");
  await getPool().query("INSERT INTO study_group_reminders (id, session_id, user_id, sent_at) VALUES ('r-p1', 's-p1', 'u-1', NOW() - INTERVAL '45 days')");
  await getPool().query("INSERT INTO study_group_token_log (line, issued_at) VALUES ('old-line', NOW() - INTERVAL '400 days')");
  const OLD = "NOW() - INTERVAL '31 days'";
  const NEW = "NOW() - INTERVAL '29 days'";
  const JUST_YOUNGER = "NOW() - INTERVAL '30 days' + INTERVAL '5 seconds'";
  const JUST_OLDER = "NOW() - INTERVAL '30 days' - INTERVAL '1 second'";
  const tutor = (id: string, status: string, at: string) =>
    `('${id}', 's-p1', 'u-1', 'e-${id}', 'q', ${at}, '${status}', ${status === "answered" ? at : "NULL"})`;
  await getPool().query(`INSERT INTO study_group_tutor_requests (id, session_id, user_id, client_event_id, text, received_at, status, answered_at) VALUES
    ${tutor("t-answered-free", "answered", OLD)}, ${tutor("t-dead-free", "dead_letter", OLD)},
    ${tutor("t-queued-old", "queued", OLD)}, ${tutor("t-inflight-old", "in_flight", OLD)},
    ${tutor("t-answered-ref-pending", "answered", OLD)}, ${tutor("t-dead-ref-unavail", "dead_letter", OLD)},
    ${tutor("t-answered-ref-settled", "answered", OLD)}, ${tutor("t-answered-ref-settled-new", "answered", OLD)},
    ${tutor("t-answered-new", "answered", NEW)}`);
  const outbox = (id: string, key: string, status: string, at: string) => `('${id}', 'room_message', '${key}', 's-p1', '{}'::jsonb, '${status}', 1, ${at}, ${status === "delivered" ? at : "NULL"})`;
  await getPool().query(`INSERT INTO study_group_outbox (id, kind, dedupe_key, session_id, payload, status, attempts, created_at, delivered_at) VALUES
    ${outbox("o-del-old", "k1", "delivered", OLD)}, ${outbox("o-dead-old", "k2", "dead", OLD)},
    ${outbox("o-del-new", "k3", "delivered", NEW)},
    ${outbox("o-del-edge-in", "k4", "delivered", JUST_YOUNGER)}, ${outbox("o-del-edge-out", "k5", "delivered", JUST_OLDER)},
    ${outbox("o-queued-old", "k6", "queued", OLD)}, ${outbox("o-sending-old", "k7", "sending", OLD)}, ${outbox("o-failed-old", "k8", "failed", OLD)},
    ${outbox("o-pend", "t-answered-ref-pending", "queued", OLD)},
    ${outbox("o-unavail", "t-dead-ref-unavail:unavailable", "failed", OLD)},
    ${outbox("o-settled", "t-answered-ref-settled", "delivered", OLD)},
    ${outbox("o-settled-new", "t-answered-ref-settled-new", "delivered", "NOW() - INTERVAL '1 day'")}`);
  const receipt = (id: string, status: string, at: string) => `('${id}', 'room_finished', 's-p1', '{}'::jsonb, '${status}', ${at})`;
  await getPool().query(`INSERT INTO study_group_webhook_receipts (receipt_id, event_type, session_id, payload, status, received_at) VALUES
    ${receipt("w-received-old", "received", OLD)}, ${receipt("w-processed-old", "processed", OLD)}, ${receipt("w-ignored-old", "ignored", OLD)},
    ${receipt("w-failed-old", "failed", OLD)}, ${receipt("w-processed-new", "processed", "NOW() - INTERVAL '1 day'")},
    ${receipt("w-processed-edge-in", "processed", JUST_YOUNGER)}, ${receipt("w-processed-edge-out", "processed", JUST_OLDER)}`);
  const history = await tableCounts();
  const foreignKeysIntoPruned = await countScalar(`SELECT count(*) FROM pg_constraint WHERE contype = 'f'
    AND confrelid IN ('study_group_outbox'::regclass, 'study_group_tutor_requests'::regclass, 'study_group_webhook_receipts'::regclass)`);
  assert.equal(foreignKeysIntoPruned, 0, "no table references a row the prune may delete");

  assert.deepEqual(await repository.pruneHistory({ olderThanDays: 30, limit: 100 }), { outbox: 4, tutorRequests: 3, webhookReceipts: 4 });
  const ids = async (sql: string) => (await rows<{ id: string }>(sql)).map((row) => row.id).sort();
  assert.deepEqual(await ids("SELECT id FROM study_group_outbox"), ["o-del-edge-in", "o-del-new", "o-failed-old", "o-pend", "o-queued-old", "o-sending-old", "o-settled-new", "o-unavail"].sort());
  assert.deepEqual(await ids("SELECT id FROM study_group_tutor_requests"), ["t-answered-new", "t-answered-ref-pending", "t-answered-ref-settled-new", "t-dead-ref-unavail", "t-inflight-old", "t-queued-old"].sort());
  assert.deepEqual(await ids("SELECT receipt_id AS id FROM study_group_webhook_receipts"), ["w-processed-edge-in", "w-processed-new", "w-received-old"].sort());
  assert.deepEqual(await tableCounts(), history, "product history (groups, memberships, sessions, intents, presences, meetings, reminders, token log) is never touched");
  assert.deepEqual(await repository.pruneHistory({ olderThanDays: 30, limit: 100 }), { outbox: 0, tutorRequests: 0, webhookReceipts: 0 }, "a second tick finds nothing (the kept rows are kept for a reason, not by the bound)");
  // Once the pending outbox row referencing a request settles and ages out, the request follows on a later tick (outbox goes first in the same tick).
  await getPool().query("UPDATE study_group_outbox SET status = 'delivered', delivered_at = NOW() WHERE id = 'o-pend'");
  assert.deepEqual(await repository.pruneHistory({ olderThanDays: 30, limit: 100 }), { outbox: 1, tutorRequests: 1, webhookReceipts: 0 });
  assert.ok(!(await ids("SELECT id FROM study_group_tutor_requests")).includes("t-answered-ref-pending"));
});

test("pruneHistory: the bound is LIMIT per table, oldest first, and a tick waits for the Study Group write lock", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-p2", maxParticipants: 4 });
  for (const age of [31, 32, 33, 34, 35]) {
    await getPool().query(`INSERT INTO study_group_outbox (id, kind, dedupe_key, session_id, payload, status, attempts, created_at, delivered_at)
      VALUES ('o-${age}', 'room_message', 'k-${age}', 's-p2', '{}'::jsonb, 'delivered', 1, NOW() - ($1::int * INTERVAL '1 day'), NOW())`, [age]);
    await getPool().query(`INSERT INTO study_group_tutor_requests (id, session_id, user_id, client_event_id, text, received_at, status, answered_at)
      VALUES ('t-${age}', 's-p2', 'u-1', 'e-${age}', 'q', NOW() - ($1::int * INTERVAL '1 day'), 'answered', NOW())`, [age]);
    await getPool().query(`INSERT INTO study_group_webhook_receipts (receipt_id, event_type, session_id, payload, status, received_at)
      VALUES ('w-${age}', 'room_finished', 's-p2', '{}'::jsonb, 'processed', NOW() - ($1::int * INTERVAL '1 day'))`, [age]);
  }
  const ids = async (sql: string) => (await rows<{ id: string }>(sql)).map((row) => row.id).sort();
  assert.deepEqual(await repository.pruneHistory({ olderThanDays: 30, limit: 2 }), { outbox: 2, tutorRequests: 2, webhookReceipts: 2 });
  assert.deepEqual(await ids("SELECT id FROM study_group_outbox"), ["o-31", "o-32", "o-33"], "the two oldest outbox rows went first");
  assert.deepEqual(await ids("SELECT id FROM study_group_tutor_requests"), ["t-31", "t-32", "t-33"]);
  assert.deepEqual(await ids("SELECT receipt_id AS id FROM study_group_webhook_receipts"), ["w-31", "w-32", "w-33"]);
  assert.deepEqual(await repository.pruneHistory({ olderThanDays: 30, limit: 2 }), { outbox: 2, tutorRequests: 2, webhookReceipts: 2 });
  assert.deepEqual(await repository.pruneHistory({ olderThanDays: 30, limit: 2 }), { outbox: 1, tutorRequests: 1, webhookReceipts: 1 });
  assert.deepEqual(await repository.pruneHistory({ olderThanDays: 30, limit: 2 }), { outbox: 0, tutorRequests: 0, webhookReceipts: 0 });
  // The lock: another transaction holding the Study Group write lock makes the prune wait.
  const holder = await getPool().connect();
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT pg_advisory_xact_lock(719302, 1)");
    let settled = false;
    const prune = repository.pruneHistory({ olderThanDays: 30, limit: 2 }).then((result) => { settled = true; return result; });
    await sleep(400);
    assert.equal(settled, false, "pruneHistory waits for the write lock");
    await holder.query("COMMIT");
    assert.deepEqual(await prune, { outbox: 0, tutorRequests: 0, webhookReceipts: 0 });
  } finally {
    holder.release();
  }
});

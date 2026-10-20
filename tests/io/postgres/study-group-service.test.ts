// Service-level PostgreSQL proofs (Phase C slice C, design §4.1): the four
// release-gate guarantees exercised through real service instances built from
// tests/io/postgres/workers.ts service modes, two per race, each holding its
// own pool — so only PostgreSQL, the advisory-lock serialization and the
// durable claim/settle/outbox statements can arbitrate.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import {
  TEST_NOW,
  closePool,
  countScalar,
  requireDatabaseUrl,
  resetSchema,
  rows,
  runWorkers,
  seatUser,
  seedGroupAndSession,
  seedTutorRequest,
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

type EnterResult = { role: string; ok: boolean; code: string | null; occupancy?: number };
type DrainResult = { role: string; tutorCalls: number; published: string[]; delivered: string | null };
type StartResult = { role: string; ok: boolean; state?: string; code?: string | null; ensureRoomCalls: string[]; incidents: Array<{ projectId: string | null }> };
type ReminderResult = { role: string; notifications: number; mails: number };

test("two service instances racing near capacity seat exactly one and the loser is session_full", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-enter-race", maxParticipants: 2, status: "live" });
  await seatUser(repository, "s-enter-race", "u-1");
  await repository.update((store) => {
    for (const userId of ["u-2", "u-3"]) {
      store.memberships.push({ id: `m-${userId}`, groupId: "g-s-enter-race", userId, role: "member", joinedAt: TEST_NOW, leftAt: null });
    }
  });
  const results = (await runWorkers([
    { mode: "service-enter", env: { LG_IO_SESSION: "s-enter-race", LG_IO_USER: "u-2" } },
    { mode: "service-enter", env: { LG_IO_SESSION: "s-enter-race", LG_IO_USER: "u-3" } }
  ])).map((outcome) => workerResult<EnterResult>(outcome));

  assert.equal(results.filter((result) => result.ok).length, 1, "exactly one service instance seats");
  assert.equal(results.filter((result) => result.code === "session_full").length, 1, "the loser is session_full");
  assert.equal(results.find((result) => result.ok)?.occupancy, 2, "the grant reports the derived occupancy");
  const winner = results[0].ok ? "u-2" : "u-3";
  const seated = await rows<{ user_id: string }>(
    "SELECT user_id FROM study_group_presences WHERE session_id = 's-enter-race' AND entered_at IS NOT NULL AND left_at IS NULL ORDER BY user_id"
  );
  assert.deepEqual(seated.map((row) => row.user_id), ["u-1", winner].sort());
  assert.equal(await countScalar("SELECT occupancy FROM live_sessions WHERE id = 's-enter-race'"), 2);
});

test("two service drains racing one queued question call the model once and publish once", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-drain-race", maxParticipants: 2, status: "live" });
  await seedTutorRequest(repository, { id: "r-race", sessionId: "s-drain-race", text: "What ended in 1933?" });
  const results = (await runWorkers([
    { mode: "service-drain-tutor", env: { LG_IO_SESSION: "s-drain-race" } },
    { mode: "service-drain-tutor", env: { LG_IO_SESSION: "s-drain-race" } }
  ])).map((outcome) => workerResult<DrainResult>(outcome));

  const tutorCalls = results.reduce((total, result) => total + result.tutorCalls, 0);
  assert.equal(tutorCalls, 1, "exactly one worker may run the model call");
  assert.deepEqual(results.flatMap((result) => result.published), ["The republic ended in 1933."], "exactly one publish across both drains");
  assert.equal(results.filter((result) => result.delivered !== null).length, 1, "exactly one worker delivered the reply");
  assert.equal(await countScalar("SELECT count(*) FROM study_group_outbox WHERE session_id = 's-drain-race'"), 1, "exactly one outbox row");
  const outbox = await rows<{ status: string; attempts: number; payload: { text: string; messageId: string; room: string } }>(
    "SELECT status, attempts, payload FROM study_group_outbox WHERE session_id = 's-drain-race'"
  );
  assert.equal(outbox[0].status, "delivered");
  assert.equal(outbox[0].attempts, 1);
  assert.equal(outbox[0].payload.messageId, "r-race");
  assert.equal(outbox[0].payload.room, "s-drain-race");
  assert.equal(outbox[0].payload.text, "The republic ended in 1933.");
  assert.equal(await countScalar("SELECT count(*) FROM study_group_tutor_requests WHERE id = 'r-race' AND status = 'answered'"), 1);
});

test("two service starts racing keep one durable project assignment that a retry reuses", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-start-race", maxParticipants: 2, status: "scheduled" });

  // Ambiguous provider failure: both racing starts must pin the same durable
  // assignment instead of advancing to the standby project.
  const raced = (await runWorkers([
    { mode: "service-start", env: { LG_IO_SESSION: "s-start-race", LG_IO_ENSURE_FAIL: "1" } },
    { mode: "service-start", env: { LG_IO_SESSION: "s-start-race", LG_IO_ENSURE_FAIL: "1" } }
  ])).map((outcome) => workerResult<StartResult>(outcome));
  assert.equal(raced.every((result) => !result.ok && result.code === "livekit_temporarily_unavailable"), true, "an ambiguous failure keeps the start temporarily unavailable");
  const assigned = (await rows<{ livekit_project_id: string | null }>("SELECT livekit_project_id FROM live_sessions WHERE id = 's-start-race'"))[0].livekit_project_id;
  assert.ok(assigned, "the durable assignment is written before any provider attempt");
  for (const result of raced) {
    assert.deepEqual(result.ensureRoomCalls, [assigned], "every ensureRoom call references the one stored project");
    assert.equal(result.incidents.length >= 1 && result.incidents.every((incident) => incident.projectId === assigned), true);
  }
  assert.equal(await countScalar("SELECT count(*) FROM study_group_meetings WHERE session_id = 's-start-race'"), 0);
  assert.equal(await countScalar("SELECT count(*) FROM live_sessions WHERE id = 's-start-race' AND status = 'scheduled'"), 1);

  // The retry provisions the SAME project and goes live; the assignment never moves.
  const retried = workerResult<StartResult>((await runWorkers([
    { mode: "service-start", env: { LG_IO_SESSION: "s-start-race" } }
  ]))[0]);
  assert.equal(retried.ok, true);
  assert.equal(retried.state, "live");
  assert.deepEqual(retried.ensureRoomCalls, [assigned], "the retry reuses the pinned project");
  const stored = (await rows<{ livekit_project_id: string | null }>("SELECT livekit_project_id FROM live_sessions WHERE id = 's-start-race'"))[0].livekit_project_id;
  assert.equal(stored, assigned);
  assert.equal(await countScalar("SELECT count(*) FROM study_group_meetings WHERE session_id = 's-start-race'"), 1);
});

test("two service reminder ticks send one notify/mail pair per due audience member", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-remind-race", maxParticipants: 2, status: "scheduled" });
  await repository.update((store) => {
    const session = store.sessions.find((item) => item.id === "s-remind-race");
    if (!session) throw new Error("session missing");
    session.startsAt = "2026-10-11T02:05:00.000Z"; // T-5: inside the 10-minute reminder window
    store.memberships.push({ id: "m-remind-u-1", groupId: "g-s-remind-race", userId: "u-1", role: "member", joinedAt: TEST_NOW, leftAt: null });
    store.intents.push({ id: "i-remind-u-1", sessionId: "s-remind-race", userId: "u-1", plannedAt: TEST_NOW, cancelledAt: null });
  });
  const results = (await runWorkers([
    { mode: "service-reminders" },
    { mode: "service-reminders" }
  ])).map((outcome) => workerResult<ReminderResult>(outcome));

  assert.equal(results.reduce((total, result) => total + result.notifications, 0), 2, "one notification per audience member");
  assert.equal(results.reduce((total, result) => total + result.mails, 0), 2, "one email per audience member");
  assert.equal(await countScalar("SELECT count(*) FROM study_group_reminders WHERE session_id = 's-remind-race'"), 2, "one reminder row per audience member");
  assert.equal(await countScalar("SELECT count(DISTINCT user_id) FROM study_group_reminders WHERE session_id = 's-remind-race'"), 2);
});

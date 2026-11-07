// PostgreSQL Study Group repository proofs (design §4.1): the four release-gate
// guarantees at the repository level, before the service slice rewires onto
// them. Every race runs across two worker processes spawned by the harness, so
// only the database can arbitrate; the parent process seeds state and verifies
// the committed rows.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { getPool } from "../../../services/persistence/db";
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

function pgCode(code: string) {
  return (error: unknown) => (error as { code?: string }).code === code;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

test("duplicate presence insert cannot double-seat (UNIQUE backstop)", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-dupe", maxParticipants: 2 });
  await seatUser(repository, "s-dupe", "u-1");
  await assert.rejects(
    () => repository.update((store) => {
      store.presences.push({
        id: "p-dupe",
        sessionId: "s-dupe",
        userId: "u-1",
        requestedAt: `${TEST_NOW}#00000001`,
        enteredAt: TEST_NOW,
        leftAt: null,
        phase: "live"
      });
    }),
    pgCode("23505")
  );
  assert.equal(await countScalar("SELECT count(*) FROM study_group_presences WHERE session_id = 's-dupe'"), 1);
  assert.equal(await countScalar("SELECT occupancy FROM live_sessions WHERE id = 's-dupe'"), 1);
});

test("concurrent admission across two workers seats exactly one and derives occupancy", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-seat", maxParticipants: 2 });
  await seatUser(repository, "s-seat", "u-1");
  const outcomes = await runWorkers([
    { mode: "seat", env: { LG_IO_SESSION: "s-seat", LG_IO_USER: "u-2" } },
    { mode: "seat", env: { LG_IO_SESSION: "s-seat", LG_IO_USER: "u-3" } }
  ]);
  const results = outcomes.map((outcome) => workerResult<{ ok: boolean; code?: string }>(outcome));
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => result.code === "session_full").length, 1);
  const seated = await rows<{ user_id: string }>("SELECT user_id FROM study_group_presences WHERE session_id = 's-seat' AND entered_at IS NOT NULL AND left_at IS NULL ORDER BY user_id");
  assert.equal(seated.length, 2);
  assert.equal(seated.some((row) => row.user_id === "u-1"), true);
  assert.equal(seated.filter((row) => row.user_id === "u-2" || row.user_id === "u-3").length, 1);
  assert.equal(await countScalar("SELECT occupancy FROM live_sessions WHERE id = 's-seat'"), 2);
  const snapshot = await repository.read();
  assert.equal(snapshot.sessions.find((session) => session.id === "s-seat")?.liveKitProjectId, null);
  assert.equal(snapshot.presences.filter((presence) => presence.sessionId === "s-seat" && presence.enteredAt && !presence.leftAt).length, 2);
});

test("occupancy CHECK fails closed when admission bypasses the capacity check", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-full", maxParticipants: 2 });
  await seatUser(repository, "s-full", "u-1");
  await seatUser(repository, "s-full", "u-2");
  assert.equal(await countScalar("SELECT occupancy FROM live_sessions WHERE id = 's-full'"), 2);
  await assert.rejects(() => seatUser(repository, "s-full", "u-3"), pgCode("23514"));
  assert.equal(await countScalar("SELECT count(*) FROM study_group_presences WHERE session_id = 's-full'"), 2);
  assert.equal(await countScalar("SELECT occupancy FROM live_sessions WHERE id = 's-full'"), 2);
});

test("conditional claim is single-flight across two workers in every racing round", async () => {
  const repository = studyGroupRepository();
  // Several racing rounds: one round catches a broken single-flight only
  // probabilistically (adversarial verification measured 6/8), so the partial
  // unique index or guard regressions must fail deterministically.
  for (let round = 1; round <= 5; round++) {
    const sessionId = `s-claim-${round}`;
    const first = `r-1-${round}`;
    const second = `r-2-${round}`;
    await seedGroupAndSession(repository, { sessionId, maxParticipants: 2 });
    await seedTutorRequest(repository, { id: first, sessionId, receivedAt: "2026-10-11T02:00:00.000Z" });
    await seedTutorRequest(repository, { id: second, sessionId, receivedAt: "2026-10-11T02:00:01.000Z" });
    const outcomes = await runWorkers([
      { mode: "claim-tutor", env: { LG_IO_SESSION: sessionId } },
      { mode: "claim-tutor", env: { LG_IO_SESSION: sessionId } }
    ]);
    const results = outcomes.map((outcome) => workerResult<{ claimed: { id: string; attempts: number | undefined } | null }>(outcome));
    const winners = results.filter((result) => result.claimed);
    assert.equal(winners.length, 1, `round ${round}: exactly one claim`);
    assert.equal(winners[0].claimed?.id, first);
    assert.equal(winners[0].claimed?.attempts, 1);
    assert.equal(await countScalar(`SELECT count(*) FROM study_group_tutor_requests WHERE session_id = '${sessionId}' AND status = 'in_flight'`), 1);
    assert.equal(await countScalar(`SELECT count(*) FROM study_group_tutor_requests WHERE id = '${second}' AND status = 'queued'`), 1);
  }
});

test("settle is lease-guarded and writes the outbox row in the same transaction", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-settle", maxParticipants: 2 });
  await seedTutorRequest(repository, { id: "r-1", sessionId: "s-settle" });
  const claimed = await repository.claimNextTutorRequest({ sessionId: "s-settle", leaseOwner: "owner-1", leaseSeconds: 60, maxAttempts: 3 });
  assert.equal(claimed?.id, "r-1");

  // A settle by a stale lease owner is a no-op (the item stays in flight).
  await repository.settleTutorRequest({
    id: "r-1",
    leaseOwner: "someone-else",
    outcome: { status: "answered", terminalReason: "answered" },
    outbox: { room: "s-settle", projectId: "p-1", text: "stale", messageId: "r-1" }
  });
  assert.equal(await countScalar("SELECT count(*) FROM study_group_tutor_requests WHERE id = 'r-1' AND status = 'in_flight'"), 1);
  assert.equal(await countScalar("SELECT count(*) FROM study_group_outbox"), 0);

  await repository.settleTutorRequest({
    id: "r-1",
    leaseOwner: "owner-1",
    outcome: { status: "answered", terminalReason: "answered" },
    outbox: { room: "s-settle", projectId: "p-1", text: "answer text", messageId: "r-1" }
  });
  const settled = await rows<{ status: string; terminal_reason: string; outbox_message_id: string; answered_at: Date | null }>(
    "SELECT status, terminal_reason, outbox_message_id, answered_at FROM study_group_tutor_requests WHERE id = 'r-1'"
  );
  assert.equal(settled[0].status, "answered");
  assert.equal(settled[0].terminal_reason, "answered");
  assert.equal(settled[0].outbox_message_id, "r-1");
  assert.notEqual(settled[0].answered_at, null);
  const outbox = await rows<{ dedupe_key: string; kind: string; status: string; payload: { room: string; projectId: string; text: string; messageId: string } }>(
    "SELECT dedupe_key, kind, status, payload FROM study_group_outbox"
  );
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].dedupe_key, "r-1");
  assert.equal(outbox[0].kind, "room_message");
  assert.equal(outbox[0].status, "queued");
  assert.deepEqual(outbox[0].payload, { room: "s-settle", projectId: "p-1", text: "answer text", messageId: "r-1" });

  // Re-settling the same item is a no-op and never creates a second outbox row.
  await repository.settleTutorRequest({
    id: "r-1",
    leaseOwner: "owner-1",
    outcome: { status: "answered", terminalReason: "answered" },
    outbox: { room: "s-settle", projectId: "p-1", text: "answer text", messageId: "r-1" }
  });
  assert.equal(await countScalar("SELECT count(*) FROM study_group_outbox"), 1);
});

test("lease expiry reclaims, attempts dead-letter, and the poisoned item does not block the queue", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-lease", maxParticipants: 2 });
  await seedTutorRequest(repository, { id: "r-1", sessionId: "s-lease", receivedAt: "2026-10-11T02:00:00.000Z" });
  await seedTutorRequest(repository, { id: "r-2", sessionId: "s-lease", receivedAt: "2026-10-11T02:00:01.000Z" });

  const first = await repository.claimNextTutorRequest({ sessionId: "s-lease", leaseOwner: "owner-1", leaseSeconds: 1, maxAttempts: 2 });
  assert.equal(first?.id, "r-1");
  assert.equal(first?.attempts, 1);

  // Before expiry the fresh lease blocks even the next queued question (single-flight).
  const blocked = await repository.claimNextTutorRequest({ sessionId: "s-lease", leaseOwner: "owner-2", leaseSeconds: 1, maxAttempts: 2 });
  assert.equal(blocked, null);

  await sleep(1500);
  const reclaimed = await repository.claimNextTutorRequest({ sessionId: "s-lease", leaseOwner: "owner-2", leaseSeconds: 1, maxAttempts: 2 });
  assert.equal(reclaimed?.id, "r-1");
  assert.equal(reclaimed?.attempts, 2);
  assert.equal(reclaimed?.status, "in_flight");

  await sleep(1500);
  const afterExhaustion = await repository.claimNextTutorRequest({ sessionId: "s-lease", leaseOwner: "owner-3", leaseSeconds: 1, maxAttempts: 2 });
  // The poisoned item is dead-lettered and the re-run claim serves the next queued question.
  assert.equal(afterExhaustion?.id, "r-2");
  const poison = await rows<{ status: string; terminal_reason: string; lease_owner: string | null }>(
    "SELECT status, terminal_reason, lease_owner FROM study_group_tutor_requests WHERE id = 'r-1'"
  );
  assert.equal(poison[0].status, "dead_letter");
  assert.equal(poison[0].terminal_reason, "attempts_exhausted");
  assert.equal(poison[0].lease_owner, null);
  // The live room is told the poisoned question will not be answered (QA M21).
  const notice = await rows<{ dedupe_key: string; status: string; payload: unknown }>("SELECT dedupe_key, status, payload FROM study_group_outbox WHERE session_id = 's-lease'");
  assert.deepEqual(notice, [{ dedupe_key: "r-1", status: "queued", payload: { room: "s-lease", projectId: "", text: "", messageId: "r-1", mode: "unavailable" } }]);
});

test("an exhausted question of a session that is no longer live is dead-lettered without a room message", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-ended", maxParticipants: 2, status: "completed" });
  await seedTutorRequest(repository, { id: "r-ended", sessionId: "s-ended", receivedAt: TEST_NOW });
  for (const owner of ["owner-1", "owner-2"]) {
    await repository.claimNextTutorRequest({ sessionId: "s-ended", leaseOwner: owner, leaseSeconds: 1, maxAttempts: 2 });
    await sleep(1500);
  }
  assert.equal(await repository.claimNextTutorRequest({ sessionId: "s-ended", leaseOwner: "owner-3", leaseSeconds: 1, maxAttempts: 2 }), null);
  assert.equal(await countScalar("SELECT count(*) FROM study_group_tutor_requests WHERE id = 'r-ended' AND status = 'dead_letter'"), 1);
  assert.equal(await countScalar("SELECT count(*) FROM study_group_outbox WHERE session_id = 's-ended'"), 0);
});

test("duplicate client_event_id enqueue is idempotent across two workers and UNIQUE-guarded", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-enqueue", maxParticipants: 2 });
  const outcomes = await runWorkers([
    { mode: "enqueue-tutor", env: { LG_IO_SESSION: "s-enqueue", LG_IO_USER: "u-1", LG_IO_CLIENT_EVENT: "evt-1", LG_IO_TEXT: "original text" } },
    { mode: "enqueue-tutor", env: { LG_IO_SESSION: "s-enqueue", LG_IO_USER: "u-1", LG_IO_CLIENT_EVENT: "evt-1", LG_IO_TEXT: "duplicate text" } }
  ]);
  const results = outcomes.map((outcome) => workerResult<{ id: string; text: string; created: boolean }>(outcome));
  const creators = results.filter((result) => result.created);
  assert.equal(creators.length, 1);
  assert.equal(results[0].id, results[1].id);
  assert.equal(results[0].text, creators[0].text);
  assert.equal(results[1].text, creators[0].text);
  assert.equal(await countScalar("SELECT count(*) FROM study_group_tutor_requests WHERE session_id = 's-enqueue'"), 1);

  // A blind duplicate insert (bypassing the in-transaction check) is rejected.
  await assert.rejects(
    () => repository.update((store) => {
      store.tutorRequests.push({ id: "r-blind", sessionId: "s-enqueue", userId: "u-1", clientEventId: "evt-1", text: "blind", receivedAt: TEST_NOW, inFlight: false });
    }),
    pgCode("23505")
  );
});

test("duplicate reminder dispatch dedupes across two workers and UNIQUE-guarded", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-remind", maxParticipants: 2 });
  const outcomes = await runWorkers([
    { mode: "dispatch-reminders", env: { LG_IO_SESSION: "s-remind", LG_IO_AUDIENCE: "u-1,u-2" } },
    { mode: "dispatch-reminders", env: { LG_IO_SESSION: "s-remind", LG_IO_AUDIENCE: "u-1,u-2" } }
  ]);
  const results = outcomes.map((outcome) => workerResult<{ jobs: string[] }>(outcome));
  const dispatched = [...results[0].jobs, ...results[1].jobs].sort();
  assert.deepEqual(dispatched, ["u-1", "u-2"]);
  assert.equal(await countScalar("SELECT count(*) FROM study_group_reminders WHERE session_id = 's-remind'"), 2);
  await assert.rejects(
    () => repository.update((store) => {
      store.reminders.push({ id: "rem-blind", sessionId: "s-remind", userId: "u-1", sentAt: TEST_NOW });
    }),
    pgCode("23505")
  );
});

test("duplicate webhook receipts dedupe across two workers", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-receipt", maxParticipants: 2 });
  const outcomes = await runWorkers([
    { mode: "insert-receipt", env: { LG_IO_RECEIPT: "rcpt-1", LG_IO_SESSION: "s-receipt" } },
    { mode: "insert-receipt", env: { LG_IO_RECEIPT: "rcpt-1", LG_IO_SESSION: "s-receipt" } }
  ]);
  const results = outcomes.map((outcome) => workerResult<{ inserted: boolean }>(outcome));
  assert.equal(results.filter((result) => result.inserted).length, 1);
  assert.equal(await countScalar("SELECT count(*) FROM study_group_webhook_receipts WHERE receipt_id = 'rcpt-1'"), 1);

  // A repeat insert is a false, not an error (mirror of stripe_events).
  assert.equal(await repository.insertWebhookReceipt({ receiptId: "rcpt-1", eventType: "room_finished", sessionId: "s-receipt", payload: { retry: true } }), false);
  const stored = await rows<{ status: string; event_type: string; processed_at: Date | null }>(
    "SELECT status, event_type, processed_at FROM study_group_webhook_receipts WHERE receipt_id = 'rcpt-1'"
  );
  assert.equal(stored[0].status, "received");
  assert.equal(stored[0].processed_at, null);

  await repository.markWebhookProcessed({ receiptId: "rcpt-1", result: "processed" });
  const processed = await rows<{ status: string; processed_at: Date | null }>("SELECT status, processed_at FROM study_group_webhook_receipts WHERE receipt_id = 'rcpt-1'");
  assert.equal(processed[0].status, "processed");
  assert.notEqual(processed[0].processed_at, null);

  assert.equal(await repository.insertWebhookReceipt({ receiptId: "rcpt-2", eventType: "participant_left", sessionId: "s-receipt", payload: { kind: "left" } }), true);
  await repository.markWebhookProcessed({ receiptId: "rcpt-2", result: "failed", failureClass: "unknown_event" });
  const failed = await rows<{ status: string; failure_class: string | null }>("SELECT status, failure_class FROM study_group_webhook_receipts WHERE receipt_id = 'rcpt-2'");
  assert.equal(failed[0].status, "failed");
  assert.equal(failed[0].failure_class, "unknown_event");
});

test("session project assignment is first-wins across concurrent updates", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-project", maxParticipants: 2 });
  const outcomes = await runWorkers([
    { mode: "assign-project", env: { LG_IO_SESSION: "s-project", LG_IO_CANDIDATE: "p-eu" } },
    { mode: "assign-project", env: { LG_IO_SESSION: "s-project", LG_IO_CANDIDATE: "p-us" } }
  ]);
  const results = outcomes.map((outcome) => workerResult<{ candidate: string; effective: string; assigned: boolean }>(outcome));
  assert.equal(results[0].effective, results[1].effective);
  assert.equal(results.filter((result) => result.assigned).length, 1);
  const stored = await rows<{ livekit_project_id: string }>("SELECT livekit_project_id FROM live_sessions WHERE id = 's-project'");
  assert.equal(stored[0].livekit_project_id, results[0].effective);

  // The design's CAS statement matches no row after the first writer committed.
  const readBack = await repository.update((store) => store.sessions.find((session) => session.id === "s-project")?.liveKitProjectId ?? null);
  assert.equal(readBack, results[0].effective, "read-back keeps the first writer's value");
  const casResult = await rows<{ livekit_project_id: string }>(
    "UPDATE live_sessions SET livekit_project_id = $1, updated_at = NOW() WHERE id = $2 AND livekit_project_id IS NULL RETURNING livekit_project_id",
    ["p-other", "s-project"]
  );
  assert.equal(casResult.length, 0);

  // And the update() first-wins pattern never overwrites the stored value.
  const effective = await repository.update((store) => {
    const row = store.sessions.find((session) => session.id === "s-project")!;
    row.liveKitProjectId ??= "p-other";
    return row.liveKitProjectId;
  });
  assert.equal(effective, results[0].effective);
});

test("outbox claim, delivery and bounded failure bookkeeping", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-outbox", maxParticipants: 2 });
  for (const requestId of ["r-1", "r-2"]) {
    await seedTutorRequest(repository, { id: requestId, sessionId: "s-outbox", receivedAt: TEST_NOW });
    const claimed = await repository.claimNextTutorRequest({ sessionId: "s-outbox", leaseOwner: `owner-${requestId}`, leaseSeconds: 60, maxAttempts: 3 });
    assert.equal(claimed?.id, requestId);
    await repository.settleTutorRequest({
      id: requestId,
      leaseOwner: `owner-${requestId}`,
      outcome: { status: "answered", terminalReason: "answered" },
      outbox: { room: "s-outbox", projectId: "p-1", text: `answer ${requestId}`, messageId: requestId }
    });
  }

  // Oldest outbox row first; failing it with a backoff parks it.
  const first = await repository.claimNextOutboxMessage({ sessionId: "s-outbox", leaseOwner: "pub-1", leaseSeconds: 60 });
  assert.equal(first?.dedupeKey, "r-1");
  assert.equal(first?.attempts, 1);
  assert.equal(first?.status, "sending");
  assert.equal(first?.payload.text, "answer r-1");
  await repository.markOutboxFailed({ id: first!.id, leaseOwner: "pub-1", failureClass: "unreachable", maxAttempts: 3, retryDelaySeconds: 60 });
  const parked = await rows<{ status: string; failure_class: string; next_attempt_at: Date | null }>(
    "SELECT status, failure_class, next_attempt_at FROM study_group_outbox WHERE id = $1",
    [first!.id]
  );
  assert.equal(parked[0].status, "failed");
  assert.equal(parked[0].failure_class, "unreachable");
  assert.notEqual(parked[0].next_attempt_at, null);

  // The parked row is skipped; the next queued row is served instead.
  const second = await repository.claimNextOutboxMessage({ sessionId: "s-outbox", leaseOwner: "pub-2", leaseSeconds: 60 });
  assert.equal(second?.dedupeKey, "r-2");
  // A stale owner cannot deliver.
  await repository.markOutboxDelivered({ id: second!.id, leaseOwner: "pub-other" });
  assert.equal(await countScalar("SELECT count(*) FROM study_group_outbox WHERE id = $1 AND status = 'sending'", [second!.id]), 1);
  await repository.markOutboxDelivered({ id: second!.id, leaseOwner: "pub-2" });
  const delivered = await rows<{ status: string; delivered_at: Date | null }>("SELECT status, delivered_at FROM study_group_outbox WHERE id = $1", [second!.id]);
  assert.equal(delivered[0].status, "delivered");
  assert.notEqual(delivered[0].delivered_at, null);

  // Exhausting attempts dead-letters the parked row with a redacted class.
  await rows("UPDATE study_group_outbox SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE id = $1", [first!.id]);
  for (let attempt = 2; attempt <= 3; attempt += 1) {
    const claim = await repository.claimNextOutboxMessage({ sessionId: "s-outbox", leaseOwner: `pub-${attempt}`, leaseSeconds: 60 });
    assert.equal(claim?.dedupeKey, "r-1");
    assert.equal(claim?.attempts, attempt);
    await repository.markOutboxFailed({ id: first!.id, leaseOwner: `pub-${attempt}`, failureClass: "rate_limited", maxAttempts: 3, retryDelaySeconds: 0 });
  }
  const dead = await rows<{ status: string; failure_class: string }>("SELECT status, failure_class FROM study_group_outbox WHERE id = $1", [first!.id]);
  assert.equal(dead[0].status, "dead");
  assert.equal(dead[0].failure_class, "rate_limited");

  // The dead answer queued one "unavailable" notice for the same message
  // (QA M21): the asker hears that no answer is coming. A notice that dies
  // in turn queues nothing further.
  const notice = await repository.claimNextOutboxMessage({ sessionId: "s-outbox", leaseOwner: "pub-4", leaseSeconds: 60 });
  assert.equal(notice?.dedupeKey, "r-1:unavailable");
  assert.deepEqual(notice?.payload, { room: "s-outbox", projectId: "p-1", text: "", messageId: "r-1", mode: "unavailable" });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (attempt > 1) {
      await rows("UPDATE study_group_outbox SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE id = $1", [notice!.id]);
      assert.equal((await repository.claimNextOutboxMessage({ sessionId: "s-outbox", leaseOwner: `notice-${attempt}`, leaseSeconds: 60 }))?.id, notice!.id);
    }
    await repository.markOutboxFailed({ id: notice!.id, leaseOwner: attempt === 1 ? "pub-4" : `notice-${attempt}`, failureClass: "unreachable", maxAttempts: 3, retryDelaySeconds: 0 });
  }
  assert.equal(await countScalar("SELECT count(*) FROM study_group_outbox WHERE id = $1 AND status = 'dead'", [notice!.id]), 1);
  assert.equal(await countScalar("SELECT count(*) FROM study_group_outbox WHERE session_id = 's-outbox'"), 3);
  assert.equal(await repository.claimNextOutboxMessage({ sessionId: "s-outbox", leaseOwner: "pub-5", leaseSeconds: 60 }), null);
});

test("token log is append-only", async () => {
  const repository = studyGroupRepository();
  await repository.appendTokenLog("line-one");
  await repository.appendTokenLog("line-two");
  const log = await rows<{ line: string }>("SELECT line FROM study_group_token_log ORDER BY id");
  assert.deepEqual(log.map((item) => item.line), ["line-one", "line-two"]);
});

test("the outbox keeps the first payload when a dedupe key already exists", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-dedupe", maxParticipants: 2 });
  await seedTutorRequest(repository, { id: "r-dedupe", sessionId: "s-dedupe" });
  const claimed = await repository.claimNextTutorRequest({ sessionId: "s-dedupe", leaseOwner: "owner-dedupe", leaseSeconds: 60, maxAttempts: 3 });
  assert.equal(claimed?.id, "r-dedupe");
  // A row with this dedupe key already exists before the settle (for example a
  // previous attempt wrote it and crashed). DO NOTHING must keep it untouched;
  // DO UPDATE would overwrite it, so this test kills that mutation.
  await rows(
    `INSERT INTO study_group_outbox (id, kind, dedupe_key, session_id, payload, status, created_at)
     VALUES ('o-pre', 'room_message', 'r-dedupe', 's-dedupe', '{"sentinel":true}'::jsonb, 'delivered', NOW())`
  );
  await repository.settleTutorRequest({
    id: "r-dedupe",
    leaseOwner: "owner-dedupe",
    outcome: { status: "answered", terminalReason: "answered" },
    outbox: { room: "s-dedupe", projectId: "p-1", text: "second payload", messageId: "r-dedupe" }
  });
  const outbox = await rows<{ id: string; payload: { sentinel?: boolean } }>("SELECT id, payload FROM study_group_outbox WHERE dedupe_key = 'r-dedupe'");
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].id, "o-pre");
  assert.equal(outbox[0].payload.sentinel, true);
});

test("a claim waits on a row held by an in-progress claim instead of skipping it", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-hold", maxParticipants: 2 });
  await seedTutorRequest(repository, { id: "r-hold-1", sessionId: "s-hold", receivedAt: "2026-10-11T02:00:00.000Z" });
  await seedTutorRequest(repository, { id: "r-hold-2", sessionId: "s-hold", receivedAt: "2026-10-11T02:00:01.000Z" });
  // Hold the earliest row the way a competing claimer does mid-statement.
  // A claim must WAIT on this row and never skip to the later one (receipt
  // order; adversarial verification round 2 proved only this shape catches
  // a SKIP LOCKED regression).
  const holder = await getPool().connect();
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT id FROM study_group_tutor_requests WHERE session_id = 's-hold' ORDER BY received_at, seq LIMIT 1 FOR UPDATE");
    const claimers = runWorkers([
      { mode: "claim-tutor", env: { LG_IO_SESSION: "s-hold" } },
      { mode: "claim-tutor", env: { LG_IO_SESSION: "s-hold" } }
    ]);
    const deadline = Date.now() + 5_000;
    let waiters = 0;
    while (Date.now() < deadline) {
      waiters = await countScalar("SELECT count(*) FROM pg_locks WHERE NOT granted AND relation = 'study_group_tutor_requests'::regclass");
      if (waiters > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(waiters > 0, true, "claimers must block on the earliest row, never skip it");
    await holder.query("COMMIT");
    const outcomes = await claimers;
    const results = outcomes.map((outcome) => workerResult<{ claimed: { id: string } | null }>(outcome));
    const winners = results.filter((result) => result.claimed);
    assert.equal(winners.length, 1, "exactly one claimer takes the released earliest row");
    assert.equal(winners[0].claimed?.id, "r-hold-1");
    assert.equal(await countScalar("SELECT count(*) FROM study_group_tutor_requests WHERE id = 'r-hold-2' AND status = 'queued'"), 1, "the later row must stay queued in receipt order");
  } finally {
    holder.release();
  }
});

// Tutor infra 2026-10-20: the claim answers askers by turns (everyone's first
// question before anyone's second, an answered question still counting as
// that asker's turn), and an asker can take back a question the Tutor has not
// started, in one conditional write.
test("the claim answers askers by turns, counting answered questions", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-fair", maxParticipants: 4 });
  await seedTutorRequest(repository, { id: "h-1", sessionId: "s-fair", userId: "host", receivedAt: "2026-09-19T02:00:00.000Z" });
  await seedTutorRequest(repository, { id: "h-2", sessionId: "s-fair", userId: "host", receivedAt: "2026-09-19T02:00:01.000Z" });
  await seedTutorRequest(repository, { id: "m-1", sessionId: "s-fair", userId: "m1", receivedAt: "2026-09-19T02:00:02.000Z" });
  const order: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    const claimed = await repository.claimNextTutorRequest({ sessionId: "s-fair", leaseOwner: `owner-${index}`, leaseSeconds: 60, maxAttempts: 3 });
    assert.ok(claimed);
    order.push(claimed.id);
    await repository.settleTutorRequest({ id: claimed.id, leaseOwner: `owner-${index}`, outcome: { status: "answered", terminalReason: "answered" }, outbox: { room: "s-fair", projectId: "p-1", text: `answer ${claimed.id}`, messageId: claimed.id } });
  }
  assert.deepEqual(order, ["h-1", "m-1", "h-2"]);
});

test("a withdrawal settles only a queued question of the asker, and a withdrawn one is never claimed", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-withdraw", maxParticipants: 4 });
  await seedTutorRequest(repository, { id: "w-1", sessionId: "s-withdraw", userId: "u-1", receivedAt: "2026-09-19T02:00:00.000Z" });
  await seedTutorRequest(repository, { id: "w-2", sessionId: "s-withdraw", userId: "u-1", receivedAt: "2026-09-19T02:00:01.000Z" });
  const claimed = await repository.claimNextTutorRequest({ sessionId: "s-withdraw", leaseOwner: "owner-1", leaseSeconds: 60, maxAttempts: 3 });
  assert.equal(claimed?.id, "w-1");
  assert.equal(await repository.withdrawTutorRequest({ id: "w-1", userId: "u-1" }), "answering");
  assert.equal(await repository.withdrawTutorRequest({ id: "w-2", userId: "someone-else" }), "not_found");
  assert.equal(await repository.withdrawTutorRequest({ id: "w-2", userId: "u-1" }), "withdrawn");
  assert.equal(await repository.withdrawTutorRequest({ id: "w-2", userId: "u-1" }), "settled", "a second withdrawal changes nothing");
  const withdrawn = await rows<{ status: string; terminal_reason: string }>("SELECT status, terminal_reason FROM study_group_tutor_requests WHERE id = 'w-2'");
  assert.deepEqual(withdrawn[0], { status: "dead_letter", terminal_reason: "withdrawn" });
  await repository.settleTutorRequest({ id: "w-1", leaseOwner: "owner-1", outcome: { status: "answered", terminalReason: "answered" }, outbox: { room: "s-withdraw", projectId: "p-1", text: "answer", messageId: "w-1" } });
  assert.equal(await repository.claimNextTutorRequest({ sessionId: "s-withdraw", leaseOwner: "owner-2", leaseSeconds: 60, maxAttempts: 3 }), null);
});

test("H2 (review 2026-11-03): a scoped read loads the scope only, a scoped update writes within it, and pruneHistory removes settled history only", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-scope-a", maxParticipants: 4 });
  await seedGroupAndSession(repository, { sessionId: "s-scope-b", maxParticipants: 4 });
  await seatUser(repository, "s-scope-a", "u-1");
  await seatUser(repository, "s-scope-b", "u-1");
  await seatUser(repository, "s-scope-b", "u-2");
  await seedTutorRequest(repository, { id: "t-scope-a", sessionId: "s-scope-a" });
  const bySession = await repository.read({ session: "s-scope-a" });
  assert.deepEqual(bySession.sessions.map((row) => row.id), ["s-scope-a"]);
  assert.deepEqual(bySession.groups.map((row) => row.id), ["g-s-scope-a"]);
  assert.deepEqual(bySession.memberships.map((row) => row.groupId), ["g-s-scope-a", "g-s-scope-a"]);
  assert.deepEqual(bySession.presences.map((row) => row.userId), ["u-1"]);
  assert.deepEqual(bySession.tutorRequests.map((row) => row.id), ["t-scope-a"]);
  const byGroup = await repository.read({ group: "g-s-scope-b" });
  assert.deepEqual(byGroup.sessions.map((row) => row.id), ["s-scope-b"]);
  assert.deepEqual(byGroup.presences.map((row) => row.userId).sort(), ["u-1", "u-2"]);
  assert.equal(byGroup.tutorRequests.length, 0);
  const seats = await repository.read({ seatsOf: "u-2" });
  assert.deepEqual(seats.sessions.map((row) => row.id), ["s-scope-b"]);
  assert.deepEqual(seats.presences.map((row) => row.userId).sort(), ["u-1", "u-2"], "everyone seated in those sessions");
  assert.deepEqual((await repository.read({ seatsOf: "nobody" })).sessions, []);
  // A scoped update changes rows in the scope and inserts new ones; the derived occupancy is still counted in the database.
  await repository.update((store) => {
    assert.deepEqual(store.sessions.map((row) => row.id), ["s-scope-b"]);
    store.presences.find((row) => row.userId === "u-2")!.leftAt = TEST_NOW;
    store.presences.push({ id: "p-scope-b-u3", sessionId: "s-scope-b", userId: "u-3", requestedAt: `${TEST_NOW}#00000009`, enteredAt: TEST_NOW, lastSeenAt: TEST_NOW, leftAt: null, phase: "live", liveKitParticipantSid: null });
  }, { session: "s-scope-b" });
  assert.equal(await countScalar("SELECT count(*) FROM study_group_presences WHERE session_id = 's-scope-b' AND left_at IS NULL"), 2);
  assert.equal(await countScalar("SELECT occupancy FROM live_sessions WHERE id = 's-scope-b'"), 2);
  assert.equal(await countScalar("SELECT count(*) FROM study_group_presences WHERE session_id = 's-scope-a' AND left_at IS NULL"), 1, "the other session is untouched");
  // Prune: settled rows older than the cutoff only, bounded, product history kept.
  await getPool().query("UPDATE study_group_tutor_requests SET status = 'answered', answered_at = NOW() - INTERVAL '45 days', received_at = NOW() - INTERVAL '45 days' WHERE id = 't-scope-a'");
  await getPool().query(`INSERT INTO study_group_outbox (id, kind, dedupe_key, session_id, payload, status, attempts, created_at, delivered_at)
    VALUES ('o-scope-old', 'room_message', 't-scope-a', 's-scope-a', '{}'::jsonb, 'delivered', 1, NOW() - INTERVAL '45 days', NOW() - INTERVAL '45 days'),
           ('o-scope-new', 'room_message', 'k-new', 's-scope-a', '{}'::jsonb, 'delivered', 1, NOW(), NOW()),
           ('o-scope-queued', 'room_message', 'k-queued', 's-scope-a', '{}'::jsonb, 'queued', 0, NOW() - INTERVAL '45 days', NULL)`);
  await getPool().query(`INSERT INTO study_group_webhook_receipts (receipt_id, event_type, session_id, payload, status, received_at)
    VALUES ('w-old-done', 'room_finished', 's-scope-a', '{}'::jsonb, 'processed', NOW() - INTERVAL '45 days'),
           ('w-old-open', 'room_finished', 's-scope-a', '{}'::jsonb, 'received', NOW() - INTERVAL '45 days')`);
  assert.deepEqual(await repository.pruneHistory({ olderThanDays: 30, limit: 100 }), { outbox: 1, tutorRequests: 1, webhookReceipts: 1 });
  assert.deepEqual((await rows<{ id: string }>("SELECT id FROM study_group_outbox ORDER BY id")).map((row) => row.id), ["o-scope-new", "o-scope-queued"]);
  assert.equal(await countScalar("SELECT count(*) FROM study_group_tutor_requests"), 0);
  assert.deepEqual((await rows<{ receipt_id: string }>("SELECT receipt_id FROM study_group_webhook_receipts")).map((row) => row.receipt_id), ["w-old-open"], "a receipt still awaiting its retry stays");
  assert.equal(await countScalar("SELECT count(*) FROM study_group_presences"), 4, "product history is never pruned");
  assert.deepEqual(await repository.pruneHistory({ olderThanDays: 30, limit: 100 }), { outbox: 0, tutorRequests: 0, webhookReceipts: 0 });
});

test("H2 (review 2026-11-03): with 10,000 rows of history a session-scoped read and write touch that session's rows only and cost a fraction of the whole store", async () => {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId: "s-perf-hot", maxParticipants: 6 });
  await seatUser(repository, "s-perf-hot", "u-1");
  // 200 groups, 2,000 completed sessions, 10,000 presences, 10,000 delivered outbox rows, 5,000 answered tutor requests: a year of use.
  const old = "NOW() - INTERVAL '40 days'";
  await getPool().query(`INSERT INTO study_groups (id, title, course_id, about, host_user_id, status, created_at, updated_at)
    SELECT 'g-perf-' || g, 'G', 'course-1', '', 'host', 'active', ${old}, ${old} FROM generate_series(1, 200) g`);
  await getPool().query(`INSERT INTO live_sessions (id, group_id, title, related_lesson_id, starts_at, duration_seconds, max_participants, focus, ai_tutor_enabled, livekit_project_id, status, occupancy, started_at, completed_at, created_at, updated_at)
    SELECT 's-perf-' || s, 'g-perf-' || ((s % 200) + 1), 'S', NULL, ${old}, 1800, 6, NULL, true, NULL, 'completed', 0, ${old}, ${old}, ${old}, ${old} FROM generate_series(1, 2000) s`);
  await getPool().query(`INSERT INTO study_group_presences (id, session_id, user_id, requested_at, entered_at, left_at, phase)
    SELECT 'p-perf-' || n, 's-perf-' || ((n % 2000) + 1), 'u-perf-' || (n / 2000), '${TEST_NOW}#00000001', ${old}, ${old}, 'live' FROM generate_series(1, 10000) n`);
  await getPool().query(`INSERT INTO study_group_outbox (id, kind, dedupe_key, session_id, payload, status, attempts, created_at, delivered_at)
    SELECT 'o-perf-' || n, 'room_message', 'k-perf-' || n, 's-perf-' || ((n % 2000) + 1), '{}'::jsonb, 'delivered', 1, ${old}, ${old} FROM generate_series(1, 10000) n`);
  await getPool().query(`INSERT INTO study_group_tutor_requests (id, session_id, user_id, client_event_id, text, received_at, status, answered_at)
    SELECT 't-perf-' || n, 's-perf-' || ((n % 2000) + 1), 'u-perf-' || (n / 2000), 'e-perf-' || n, 'q', ${old}, 'answered', ${old} FROM generate_series(1, 5000) n`);
  assert.equal(await countScalar("SELECT count(*) FROM study_group_presences"), 10001);
  const time = async (work: () => Promise<unknown>, runs: number) => {
    const samples: number[] = [];
    for (let index = 0; index < runs; index += 1) {
      const started = process.hrtime.bigint();
      await work();
      samples.push(Number(process.hrtime.bigint() - started) / 1e6);
    }
    return samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  };
  await repository.read();
  const wholeMs = await time(() => repository.read(), 3);
  const scopedMs = await time(() => repository.read({ session: "s-perf-hot" }), 5);
  const scoped = await repository.read({ session: "s-perf-hot" });
  assert.deepEqual(scoped.sessions.map((row) => row.id), ["s-perf-hot"]);
  assert.equal(scoped.presences.length, 1);
  assert.equal(scoped.outbox.length, 0);
  assert.equal(scoped.tutorRequests.length, 0);
  assert.equal((await repository.read()).sessions.length, 2001, "the whole store is still there for the callers that need it");
  const writeMs = await time(() => repository.update((store) => { store.presences[0].lastSeenAt = TEST_NOW; }, { session: "s-perf-hot" }), 5);
  console.info(JSON.stringify({ type: "study_group.scope_perf", wholeMs: Math.round(wholeMs), scopedReadMs: Math.round(scopedMs * 10) / 10, scopedWriteMs: Math.round(writeMs * 10) / 10 }));
  assert.ok(scopedMs * 5 < wholeMs, `a scoped read (${scopedMs.toFixed(1)} ms) is at least five times cheaper than the whole store (${wholeMs.toFixed(1)} ms)`);
  assert.ok(writeMs * 3 < wholeMs, `a scoped write (${writeMs.toFixed(1)} ms) costs less than a third of one whole read (${wholeMs.toFixed(1)} ms)`);
  // The prune bound holds under volume: one tick removes at most `limit` rows per table.
  assert.deepEqual(await repository.pruneHistory({ olderThanDays: 30, limit: 1000 }), { outbox: 1000, tutorRequests: 1000, webhookReceipts: 0 });
  assert.equal(await countScalar("SELECT count(*) FROM study_group_outbox"), 9000);
});

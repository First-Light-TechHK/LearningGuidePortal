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
  assert.equal(await repository.claimNextOutboxMessage({ sessionId: "s-outbox", leaseOwner: "pub-4", leaseSeconds: 60 }), null);
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

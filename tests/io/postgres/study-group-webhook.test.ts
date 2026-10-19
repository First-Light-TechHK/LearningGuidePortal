// PostgreSQL-level proofs for the slice-2 signed-webhook path (design §3): the
// receipt-first insert, the resume of `received`/abandoned deliveries, the
// settled duplicate with zero side effects, and the unknown-room ignore —
// exercised through real service instances built by the workers.ts
// `service-webhook` mode, each process holding its own pool, so only
// PostgreSQL arbitrates. Since the QA 2026-10-19 seat redesign a provider
// event never touches a seat: every verified event settles `ignored`.
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

const EVENT_AT = "2026-10-11T02:05:00.000Z";
type WebhookResult = { role: string; outcome: { status: "processed" | "ignored" | "duplicate" } };

function webhookEnv(input: { session: string; eventId: string; identity: string; eventType?: string }): Record<string, string> {
  return {
    LG_IO_SESSION: input.session,
    LG_IO_EVENT_ID: input.eventId,
    LG_IO_IDENTITY: input.identity,
    LG_IO_CREATED_AT: EVENT_AT,
    ...(input.eventType ? { LG_IO_EVENT_TYPE: input.eventType } : {})
  };
}

async function deliverWebhook(env: Record<string, string>): Promise<WebhookResult> {
  return workerResult<WebhookResult>((await runWorkers([{ mode: "service-webhook", env }]))[0]);
}

/** A live session with a u-2 membership and an OPEN u-2 presence, plus any extra open seats. */
async function seedRoomWithOpenPresence(sessionId: string, extraOpenUsers: string[] = []) {
  const repository = studyGroupRepository();
  await seedGroupAndSession(repository, { sessionId, maxParticipants: 4, status: "live" });
  await repository.update((store) => {
    store.memberships.push({ id: `m-${sessionId}-u-2`, groupId: `g-${sessionId}`, userId: "u-2", role: "member", joinedAt: TEST_NOW, leftAt: null });
  });
  await seatUser(repository, sessionId, "u-2");
  for (const userId of extraOpenUsers) await seatUser(repository, sessionId, userId);
  return repository;
}

async function presenceLeftAt(sessionId: string, userId: string): Promise<string | null> {
  const result = await rows<{ left_at: Date | null }>(
    "SELECT left_at FROM study_group_presences WHERE session_id = $1 AND user_id = $2",
    [sessionId, userId]
  );
  const row = result[0];
  return row && row.left_at ? row.left_at.toISOString() : null;
}

test("two processes delivering the same signed event leave one receipt and the seat untouched", async () => {
  const repository = await seedRoomWithOpenPresence("s-wh-race", ["u-9"]);
  const before = JSON.stringify(await repository.read());
  const results = (await runWorkers([
    { mode: "service-webhook", env: webhookEnv({ session: "s-wh-race", eventId: "e-race-1", identity: "u-2" }) },
    { mode: "service-webhook", env: webhookEnv({ session: "s-wh-race", eventId: "e-race-1", identity: "u-2" }) }
  ])).map((outcome) => workerResult<WebhookResult>(outcome));

  // The race splits as (ignored, duplicate) when the loser reads the settled
  // receipt, or as (ignored, ignored) when both resume the same `received` row.
  const statuses = results.map((result) => result.outcome.status);
  const seen = statuses.join(" + ");
  for (const status of statuses) {
    assert.equal(status === "ignored" || status === "duplicate", true, `worker outcomes must be ignored/duplicate, saw [${seen}]`);
  }
  assert.equal(statuses.includes("ignored"), true, `at least one worker settles the event, saw [${seen}]`);
  assert.equal(await countScalar("SELECT count(*) FROM study_group_webhook_receipts WHERE receipt_id = 'e-race-1'"), 1, `exactly one receipt row, outcomes [${seen}]`);
  assert.equal(await countScalar("SELECT count(*) FROM study_group_webhook_receipts WHERE receipt_id = 'e-race-1' AND status = 'ignored'"), 1, `the single receipt settles ignored, outcomes [${seen}]`);
  assert.equal(await presenceLeftAt("s-wh-race", "u-2"), null, `the seat is the lease's, not the provider's, outcomes [${seen}]`);
  assert.equal(JSON.stringify(await repository.read()), before, `no store row changed, outcomes [${seen}]`);
});

test("a settled duplicate delivery has zero side effects", async () => {
  const repository = await seedRoomWithOpenPresence("s-wh-dupe");
  const first = await deliverWebhook(webhookEnv({ session: "s-wh-dupe", eventId: "e-dupe-1", identity: "u-2" }));
  assert.equal(first.outcome.status, "ignored");
  const receiptBefore = (await rows<{ status: string; processed_at: Date | null }>(
    "SELECT status, processed_at FROM study_group_webhook_receipts WHERE receipt_id = 'e-dupe-1'"
  ))[0];
  assert.equal(receiptBefore.status, "ignored");
  assert.notEqual(receiptBefore.processed_at, null);
  const snapshotBefore = JSON.stringify(await repository.read());

  const second = await deliverWebhook(webhookEnv({ session: "s-wh-dupe", eventId: "e-dupe-1", identity: "u-2" }));
  assert.equal(second.outcome.status, "duplicate");

  assert.equal(await countScalar("SELECT count(*) FROM study_group_webhook_receipts WHERE receipt_id = 'e-dupe-1'"), 1, "the duplicate writes no second receipt");
  assert.equal(JSON.stringify(await repository.read()), snapshotBefore, "no store row changed");
  const receiptAfter = (await rows<{ status: string; processed_at: Date | null }>(
    "SELECT status, processed_at FROM study_group_webhook_receipts WHERE receipt_id = 'e-dupe-1'"
  ))[0];
  assert.equal(receiptAfter.status, "ignored");
  assert.equal(receiptAfter.processed_at?.getTime(), receiptBefore.processed_at?.getTime(), "the duplicate never re-marks the receipt");
});

test("a crashed delivery resumes from its received receipt", async () => {
  await seedRoomWithOpenPresence("s-wh-crash");
  await rows(
    "INSERT INTO study_group_webhook_receipts (receipt_id, event_type, session_id, payload) VALUES ($1, $2, $3, $4::jsonb)",
    ["e-crash-1", "participant_left", "s-wh-crash", "{}"]
  );
  assert.equal(await countScalar("SELECT count(*) FROM study_group_webhook_receipts WHERE receipt_id = 'e-crash-1' AND status = 'received'"), 1, "the 012 column default keeps the pre-inserted receipt received");

  const result = await deliverWebhook(webhookEnv({ session: "s-wh-crash", eventId: "e-crash-1", identity: "u-2" }));

  assert.equal(result.outcome.status, "ignored");
  const receipt = (await rows<{ status: string; processed_at: Date | null }>(
    "SELECT status, processed_at FROM study_group_webhook_receipts WHERE receipt_id = 'e-crash-1'"
  ))[0];
  assert.equal(receipt.status, "ignored");
  assert.notEqual(receipt.processed_at, null);
  assert.equal(await presenceLeftAt("s-wh-crash", "u-2"), null);
});

test("a duplicate of a settled receipt cannot close an open seat", async () => {
  await seedRoomWithOpenPresence("s-wh-settled");
  await rows(
    "INSERT INTO study_group_webhook_receipts (receipt_id, event_type, session_id, payload, status, processed_at) VALUES ($1, $2, $3, $4::jsonb, 'processed', NOW())",
    ["e-settled-1", "participant_left", "s-wh-settled", "{}"]
  );

  const result = await deliverWebhook(webhookEnv({ session: "s-wh-settled", eventId: "e-settled-1", identity: "u-2" }));

  assert.equal(result.outcome.status, "duplicate");
  assert.equal(await countScalar("SELECT count(*) FROM study_group_presences WHERE session_id = 's-wh-settled' AND user_id = 'u-2' AND left_at IS NULL"), 1, "the open seat stays open");
  assert.equal(await countScalar("SELECT count(*) FROM study_group_webhook_receipts WHERE receipt_id = 'e-settled-1'"), 1);
});

test("an event for an unknown room is recorded and ignored", async () => {
  await seedRoomWithOpenPresence("s-wh-keep");

  const result = await deliverWebhook(webhookEnv({ session: "s-wh-unknown", eventId: "e-unknown-1", identity: "u-2" }));

  assert.equal(result.outcome.status, "ignored");
  assert.equal(await countScalar("SELECT count(*) FROM study_group_webhook_receipts WHERE receipt_id = 'e-unknown-1' AND status = 'ignored'"), 1);
  assert.equal(await countScalar("SELECT count(*) FROM study_group_webhook_receipts"), 1, "only the one receipt was recorded");
  assert.equal(await countScalar("SELECT count(*) FROM study_group_presences WHERE left_at IS NOT NULL"), 0, "all presences untouched");
  assert.equal(await presenceLeftAt("s-wh-keep", "u-2"), null);
});

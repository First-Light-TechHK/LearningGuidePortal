import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { ensureSchema, getPool, query } from "@/services/persistence/db";
import {
  type AttendanceIntentRow,
  type LiveSessionRow,
  type MeetingRow,
  type MembershipRow,
  type OutboxRow,
  type PresenceRow,
  type ReminderRow,
  type StudyGroupRow,
  type StudyGroupStore,
  type TutorOutboxPayload,
  type TutorRequestRow,
  type TutorRequestStatus
} from "@/modules/group-study/domain";
import type { StudyGroupOperationalMetrics, StudyGroupRepository, WebhookReceiptRow } from "@/modules/group-study/repository";

// Study Group production store (Phase C slice 1, design §3.1/§3.2). SQL lives
// only here (AGENTS: repositories own SQL); the schema is
// db/migrations/012_study_group_persistence.sql, mirrored by ensureSchema.
//
// Serialization: every write transaction takes pg_advisory_xact_lock(719302, 1)
// before reading the snapshot, so check-then-act mutates commit atomically
// across App Runner instances (719301 is the payment aggregate's lock). Claims
// and the outbox run outside the lock at per-session granularity.
const STUDY_GROUP_WRITE_LOCK = "SELECT pg_advisory_xact_lock(719302, 1)";

type GroupDbRow = {
  id: string;
  title: string;
  course_id: string;
  about: string;
  host_user_id: string;
  status: StudyGroupRow["status"];
  created_at: Date;
  updated_at: Date;
};

type MembershipDbRow = {
  id: string;
  group_id: string;
  user_id: string;
  role: MembershipRow["role"];
  joined_at: Date;
  left_at: Date | null;
};

type SessionDbRow = {
  id: string;
  group_id: string;
  title: string;
  related_lesson_id: string | null;
  starts_at: Date;
  duration_seconds: number;
  max_participants: number;
  focus: string | null;
  ai_tutor_enabled: boolean;
  livekit_project_id: string | null;
  status: LiveSessionRow["status"];
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type IntentDbRow = {
  id: string;
  session_id: string;
  user_id: string;
  planned_at: Date;
  cancelled_at: Date | null;
};

type PresenceDbRow = {
  id: string;
  session_id: string;
  user_id: string;
  requested_at: string;
  entered_at: Date | null;
  left_at: Date | null;
  phase: PresenceRow["phase"];
  livekit_participant_sid: string | null;
  last_seen_at: Date | null;
};

type MeetingDbRow = {
  id: string;
  session_id: string;
  started_at: Date;
  ended_at: Date | null;
};

type ReminderDbRow = {
  id: string;
  session_id: string;
  user_id: string;
  sent_at: Date;
};

type TutorDbRow = {
  id: string;
  seq: string | number;
  session_id: string;
  user_id: string;
  client_event_id: string;
  text: string;
  received_at: Date;
  status: TutorRequestStatus;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  next_attempt_at: Date | null;
  attempts: number;
  terminal_reason: string | null;
  outbox_message_id: string | null;
  answered_at: Date | null;
};

type OutboxDbRow = {
  id: string;
  kind: OutboxRow["kind"];
  dedupe_key: string;
  session_id: string;
  payload: OutboxRow["payload"];
  status: OutboxRow["status"];
  attempts: number;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  next_attempt_at: Date | null;
  failure_class: string | null;
  created_at: Date;
  delivered_at: Date | null;
};

type WebhookReceiptDbRow = {
  receipt_id: string;
  status: WebhookReceiptRow["status"];
  failure_class: string | null;
};

type LiveSessionRefDbRow = {
  id: string;
  livekit_project_id: string | null;
};

// COUNT(*) arrives as a bigint string and FLOOR(...) as a numeric string;
// Number() maps both to the integer metrics the service reports.
type OperationalMetricsDbRow = {
  tutor_queued: string | number;
  tutor_in_flight: string | number;
  tutor_dead_letter: string | number;
  tutor_oldest_queued_age_seconds: string | number;
  webhook_abandoned: string | number;
  webhook_failed: string | number;
};

function iso(value: Date): string;
function iso(value: Date | null): string | null;
function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function mapGroup(row: GroupDbRow): StudyGroupRow {
  return {
    id: row.id,
    title: row.title,
    courseId: row.course_id,
    about: row.about,
    hostUserId: row.host_user_id,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function mapMembership(row: MembershipDbRow): MembershipRow {
  return {
    id: row.id,
    groupId: row.group_id,
    userId: row.user_id,
    role: row.role,
    joinedAt: iso(row.joined_at),
    leftAt: iso(row.left_at)
  };
}

function mapSession(row: SessionDbRow): LiveSessionRow {
  return {
    id: row.id,
    groupId: row.group_id,
    title: row.title,
    relatedLessonId: row.related_lesson_id,
    startsAt: iso(row.starts_at),
    durationSeconds: row.duration_seconds,
    maxParticipants: row.max_participants,
    focus: row.focus,
    aiTutorEnabled: row.ai_tutor_enabled,
    liveKitProjectId: row.livekit_project_id,
    status: row.status,
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function mapIntent(row: IntentDbRow): AttendanceIntentRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    plannedAt: iso(row.planned_at),
    cancelledAt: iso(row.cancelled_at)
  };
}

function mapPresence(row: PresenceDbRow): PresenceRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    requestedAt: row.requested_at,
    enteredAt: iso(row.entered_at),
    leftAt: iso(row.left_at),
    phase: row.phase,
    // NULL (including every row written before the column existed) reads as
    // "connection unknown"; the webhook's timestamp guard decides for it.
    liveKitParticipantSid: row.livekit_participant_sid ?? null,
    // The seat lease (presence.ts); NULL on rows written before the column
    // existed, which the lease reads as their entry time.
    lastSeenAt: iso(row.last_seen_at ?? null)
  };
}

function mapMeeting(row: MeetingDbRow): MeetingRow {
  return { id: row.id, sessionId: row.session_id, startedAt: iso(row.started_at), endedAt: iso(row.ended_at) };
}

function mapReminder(row: ReminderDbRow): ReminderRow {
  return { id: row.id, sessionId: row.session_id, userId: row.user_id, sentAt: iso(row.sent_at) };
}

function mapTutorRequest(row: TutorDbRow): TutorRequestRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    clientEventId: row.client_event_id,
    text: row.text,
    receivedAt: iso(row.received_at),
    inFlight: row.status === "in_flight",
    answeredAt: iso(row.answered_at),
    status: row.status,
    seq: Number(row.seq),
    leaseOwner: row.lease_owner,
    leaseExpiresAt: iso(row.lease_expires_at),
    nextAttemptAt: iso(row.next_attempt_at),
    attempts: row.attempts,
    terminalReason: row.terminal_reason,
    outboxMessageId: row.outbox_message_id
  };
}

function mapOutbox(row: OutboxDbRow): OutboxRow {
  return {
    id: row.id,
    kind: row.kind,
    dedupeKey: row.dedupe_key,
    sessionId: row.session_id,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: iso(row.lease_expires_at),
    nextAttemptAt: iso(row.next_attempt_at),
    failureClass: row.failure_class,
    createdAt: iso(row.created_at),
    deliveredAt: iso(row.delivered_at)
  };
}

function mapWebhookReceipt(row: WebhookReceiptDbRow): WebhookReceiptRow {
  return {
    receiptId: row.receipt_id,
    status: row.status,
    failureClass: row.failure_class
  };
}

function mapLiveSessionRef(row: LiveSessionRefDbRow): { id: string; liveKitProjectId: string | null } {
  return { id: row.id, liveKitProjectId: row.livekit_project_id };
}

async function loadStore(client: PoolClient): Promise<StudyGroupStore> {
  // Sequential on one connection: the advisory lock (or the REPEATABLE READ
  // transaction) makes every SELECT see one consistent snapshot.
  const groups = await client.query<GroupDbRow>("SELECT * FROM study_groups");
  const memberships = await client.query<MembershipDbRow>("SELECT * FROM study_group_memberships");
  const sessions = await client.query<SessionDbRow>("SELECT * FROM live_sessions");
  const intents = await client.query<IntentDbRow>("SELECT * FROM study_group_attendance_intents");
  const presences = await client.query<PresenceDbRow>("SELECT * FROM study_group_presences");
  const meetings = await client.query<MeetingDbRow>("SELECT * FROM study_group_meetings");
  const reminders = await client.query<ReminderDbRow>("SELECT * FROM study_group_reminders");
  const tutorRequests = await client.query<TutorDbRow>("SELECT * FROM study_group_tutor_requests");
  const outbox = await client.query<OutboxDbRow>("SELECT * FROM study_group_outbox");
  return {
    groups: groups.rows.map(mapGroup),
    memberships: memberships.rows.map(mapMembership),
    sessions: sessions.rows.map(mapSession),
    intents: intents.rows.map(mapIntent),
    presences: presences.rows.map(mapPresence),
    meetings: meetings.rows.map(mapMeeting),
    reminders: reminders.rows.map(mapReminder),
    tutorRequests: tutorRequests.rows.map(mapTutorRequest),
    outbox: outbox.rows.map(mapOutbox)
  };
}

function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

function changed<T extends { id: string }>(before: Map<string, T>, row: T): boolean {
  const previous = before.get(row.id);
  return !previous || JSON.stringify(previous) !== JSON.stringify(row);
}

function assertNoDeletions<T extends { id: string }>(table: string, before: Map<string, T>, after: T[]) {
  const afterIds = new Set(after.map((row) => row.id));
  for (const id of before.keys()) {
    if (!afterIds.has(id)) throw new Error(`Study Group rows cannot be deleted through update() (${table} ${id}).`);
  }
}

function tutorStatusOf(row: TutorRequestRow): TutorRequestStatus {
  if (row.status) return row.status;
  if (row.answeredAt) return "answered";
  return row.inFlight ? "in_flight" : "queued";
}

async function persistDiff(client: PoolClient, before: StudyGroupStore, after: StudyGroupStore) {
  // Order (design §3.2): base tables → presences → live_sessions, whose
  // occupancy column is derived from the presences last so the
  // CHECK (occupancy <= max_participants) backstop sees the final seat count.
  const beforeGroups = byId(before.groups);
  const beforeMemberships = byId(before.memberships);
  const beforeSessions = byId(before.sessions);
  const beforeIntents = byId(before.intents);
  const beforePresences = byId(before.presences);
  const beforeMeetings = byId(before.meetings);
  const beforeReminders = byId(before.reminders);
  const beforeTutorRequests = byId(before.tutorRequests);
  assertNoDeletions("study_groups", beforeGroups, after.groups);
  assertNoDeletions("study_group_memberships", beforeMemberships, after.memberships);
  assertNoDeletions("live_sessions", beforeSessions, after.sessions);
  assertNoDeletions("study_group_attendance_intents", beforeIntents, after.intents);
  assertNoDeletions("study_group_presences", beforePresences, after.presences);
  assertNoDeletions("study_group_meetings", beforeMeetings, after.meetings);
  assertNoDeletions("study_group_reminders", beforeReminders, after.reminders);
  assertNoDeletions("study_group_tutor_requests", beforeTutorRequests, after.tutorRequests);
  if (JSON.stringify(before.outbox) !== JSON.stringify(after.outbox)) {
    throw new Error("The Study Group outbox is written by the delivery operations, not update().");
  }

  for (const row of after.groups) {
    if (!changed(beforeGroups, row)) continue;
    await client.query(
      `INSERT INTO study_groups (id, title, course_id, about, host_user_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, course_id = EXCLUDED.course_id, about = EXCLUDED.about,
         host_user_id = EXCLUDED.host_user_id, status = EXCLUDED.status, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
      [row.id, row.title, row.courseId, row.about, row.hostUserId, row.status, row.createdAt, row.updatedAt]
    );
  }
  for (const row of after.memberships) {
    if (!changed(beforeMemberships, row)) continue;
    await client.query(
      `INSERT INTO study_group_memberships (id, group_id, user_id, role, joined_at, left_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET group_id = EXCLUDED.group_id, user_id = EXCLUDED.user_id, role = EXCLUDED.role,
         joined_at = EXCLUDED.joined_at, left_at = EXCLUDED.left_at`,
      [row.id, row.groupId, row.userId, row.role, row.joinedAt, row.leftAt]
    );
  }
  for (const row of after.intents) {
    if (!changed(beforeIntents, row)) continue;
    await client.query(
      `INSERT INTO study_group_attendance_intents (id, session_id, user_id, planned_at, cancelled_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET session_id = EXCLUDED.session_id, user_id = EXCLUDED.user_id,
         planned_at = EXCLUDED.planned_at, cancelled_at = EXCLUDED.cancelled_at`,
      [row.id, row.sessionId, row.userId, row.plannedAt, row.cancelledAt]
    );
  }
  for (const row of after.meetings) {
    if (!changed(beforeMeetings, row)) continue;
    await client.query(
      `INSERT INTO study_group_meetings (id, session_id, started_at, ended_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET session_id = EXCLUDED.session_id, started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at`,
      [row.id, row.sessionId, row.startedAt, row.endedAt]
    );
  }
  for (const row of after.reminders) {
    if (!changed(beforeReminders, row)) continue;
    await client.query(
      `INSERT INTO study_group_reminders (id, session_id, user_id, sent_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET session_id = EXCLUDED.session_id, user_id = EXCLUDED.user_id, sent_at = EXCLUDED.sent_at`,
      [row.id, row.sessionId, row.userId, row.sentAt]
    );
  }
  for (const row of after.tutorRequests) {
    if (!changed(beforeTutorRequests, row)) continue;
    await client.query(
      `INSERT INTO study_group_tutor_requests
         (id, session_id, user_id, client_event_id, text, received_at, status, lease_owner, lease_expires_at,
          next_attempt_at, attempts, terminal_reason, outbox_message_id, answered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (id) DO UPDATE SET session_id = EXCLUDED.session_id, user_id = EXCLUDED.user_id,
         client_event_id = EXCLUDED.client_event_id, text = EXCLUDED.text, received_at = EXCLUDED.received_at,
         status = EXCLUDED.status, lease_owner = EXCLUDED.lease_owner, lease_expires_at = EXCLUDED.lease_expires_at,
         next_attempt_at = EXCLUDED.next_attempt_at, attempts = EXCLUDED.attempts, terminal_reason = EXCLUDED.terminal_reason,
         outbox_message_id = EXCLUDED.outbox_message_id, answered_at = EXCLUDED.answered_at`,
      [
        row.id, row.sessionId, row.userId, row.clientEventId, row.text, row.receivedAt, tutorStatusOf(row),
        row.leaseOwner ?? null, row.leaseExpiresAt ?? null, row.nextAttemptAt ?? null, row.attempts ?? 0,
        row.terminalReason ?? null, row.outboxMessageId ?? null, row.answeredAt ?? null
      ]
    );
  }
  const occupancySessions = new Set<string>();
  for (const row of after.presences) {
    if (!changed(beforePresences, row)) continue;
    occupancySessions.add(row.sessionId);
    await client.query(
      `INSERT INTO study_group_presences (id, session_id, user_id, requested_at, entered_at, left_at, phase, livekit_participant_sid, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET session_id = EXCLUDED.session_id, user_id = EXCLUDED.user_id,
         requested_at = EXCLUDED.requested_at, entered_at = EXCLUDED.entered_at, left_at = EXCLUDED.left_at,
         phase = EXCLUDED.phase, livekit_participant_sid = EXCLUDED.livekit_participant_sid, last_seen_at = EXCLUDED.last_seen_at`,
      [row.id, row.sessionId, row.userId, row.requestedAt, row.enteredAt, row.leftAt, row.phase, row.liveKitParticipantSid ?? null, row.lastSeenAt ?? null]
    );
  }
  for (const row of after.sessions) {
    if (!changed(beforeSessions, row) && !occupancySessions.has(row.id)) continue;
    await client.query(
      `INSERT INTO live_sessions
         (id, group_id, title, related_lesson_id, starts_at, duration_seconds, max_participants, focus, ai_tutor_enabled,
          livekit_project_id, status, occupancy, started_at, completed_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
         (SELECT count(*) FROM study_group_presences WHERE session_id = $1 AND entered_at IS NOT NULL AND left_at IS NULL),
         $12, $13, $14, $15)
       ON CONFLICT (id) DO UPDATE SET group_id = EXCLUDED.group_id, title = EXCLUDED.title,
         related_lesson_id = EXCLUDED.related_lesson_id, starts_at = EXCLUDED.starts_at, duration_seconds = EXCLUDED.duration_seconds,
         max_participants = EXCLUDED.max_participants, focus = EXCLUDED.focus, ai_tutor_enabled = EXCLUDED.ai_tutor_enabled,
         livekit_project_id = EXCLUDED.livekit_project_id, status = EXCLUDED.status, occupancy = EXCLUDED.occupancy,
         started_at = EXCLUDED.started_at, completed_at = EXCLUDED.completed_at, created_at = EXCLUDED.created_at,
         updated_at = EXCLUDED.updated_at`,
      [
        row.id, row.groupId, row.title, row.relatedLessonId, row.startsAt, row.durationSeconds, row.maxParticipants,
        row.focus, row.aiTutorEnabled, row.liveKitProjectId, row.status, row.startedAt, row.completedAt, row.createdAt, row.updatedAt
      ]
    );
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null && (typeof value === "object" || typeof value === "function") && typeof (value as PromiseLike<unknown>).then === "function";
}

export function createPostgresStudyGroupRepository(): StudyGroupRepository {
  async function read(): Promise<StudyGroupStore> {
    await ensureSchema();
    const client = await getPool().connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const store = await loadStore(client);
      await client.query("COMMIT");
      return store;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The connection is unusable; the original error is the real one.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function update<T>(mutate: (store: StudyGroupStore) => T | Promise<T>): Promise<T> {
    await ensureSchema();
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query(STUDY_GROUP_WRITE_LOCK);
      const snapshot = await loadStore(client);
      const before = structuredClone(snapshot);
      const result = mutate(snapshot);
      if (isThenable(result)) {
        throw new Error("Study Group update() requires a synchronous mutate (design §3.2); the mutate promise pended before the diff stage.");
      }
      await persistDiff(client, before, snapshot);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The connection is unusable; the original error is the real one.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function appendTokenLog(line: string) {
    await query("INSERT INTO study_group_token_log (line) VALUES ($1)", [line]);
  }

  async function attemptTutorClaim(input: { sessionId: string; leaseOwner: string; leaseSeconds: number }) {
    try {
      // The single-statement conditional claim (design §3.2): lease expiry
      // reclaim, the NOT EXISTS one-in-flight-per-session refinement, receipt
      // order (received_at, seq) and a plain FOR UPDATE. Deliberately NOT
      // SKIP LOCKED: with SKIP LOCKED a claimer skipped an earlier row locked
      // by a competing in-flight claim and fell through to a LATER row, which
      // then lost the partial-index race and left the earlier question queued
      // behind — receipt order must not invert. A plain FOR UPDATE serializes
      // same-session claim attempts on the earliest candidate; the lock-wait
      // predicate recheck then skips it once the winner commits.
      // "Earliest" is the fair answer order (tutor infra 2026-10-20, domain.ts
      // tutorFairTurn): by the asker's turn — how many of their own questions
      // in this session (waiting or answered) came in before this one — then
      // receipt order.
      const result = await getPool().query<TutorDbRow>(
        `UPDATE study_group_tutor_requests SET
           status = 'in_flight', lease_owner = $1,
           lease_expires_at = NOW() + ($2::int * INTERVAL '1 second'),
           attempts = attempts + 1, next_attempt_at = NULL
         WHERE id = (
           SELECT candidate.id FROM study_group_tutor_requests candidate
           WHERE candidate.session_id = $3
             AND (candidate.next_attempt_at IS NULL OR candidate.next_attempt_at <= NOW())
             AND (
               candidate.status = 'queued'
               OR (candidate.status = 'in_flight' AND candidate.lease_expires_at <= NOW())
             )
             AND NOT EXISTS (
               SELECT 1 FROM study_group_tutor_requests other
               WHERE other.session_id = $3 AND other.status = 'in_flight'
                 AND other.lease_expires_at > NOW())
           ORDER BY (
               SELECT count(*) FROM study_group_tutor_requests mine
               WHERE mine.session_id = candidate.session_id AND mine.user_id = candidate.user_id
                 AND mine.id <> candidate.id
                 AND mine.status IN ('queued', 'in_flight', 'answered')
                 AND (mine.received_at, mine.seq) < (candidate.received_at, candidate.seq)),
             candidate.received_at, candidate.seq
           LIMIT 1 FOR UPDATE OF candidate)
         RETURNING *`,
        [input.leaseOwner, input.leaseSeconds, input.sessionId]
      );
      return result.rows[0] ? mapTutorRequest(result.rows[0]) : null;
    } catch (error) {
      // The claimer fell through to a later row while the winner of the
      // earliest row committed: the partial unique index rejects the second
      // in-flight row. That is the single-flight guarantee, not an error path
      // (design §3.2).
      if ((error as { code?: string }).code === "23505") return null;
      throw error;
    }
  }

  async function claimNextTutorRequest(input: { sessionId: string; leaseOwner: string; leaseSeconds: number; maxAttempts: number }): Promise<TutorRequestRow | null> {
    await ensureSchema();
    const claimed = await attemptTutorClaim(input);
    if (!claimed) return null;
    if ((claimed.attempts ?? 0) > input.maxAttempts) {
      // The candidate was an expired lease whose attempts had already reached
      // maxAttempts: dead-letter it and re-run the bounded claim once more so
      // a poisoned item cannot stall later questions (design §3.2).
      // One statement: the dead letter and, while the session is live, its
      // "unavailable" room message (QA M21), so the asker is not left waiting.
      await query(
        `WITH dead AS (
           UPDATE study_group_tutor_requests
           SET status = 'dead_letter', terminal_reason = 'attempts_exhausted',
             lease_owner = NULL, lease_expires_at = NULL, next_attempt_at = NULL
           WHERE id = $1 AND lease_owner = $2 AND status = 'in_flight'
           RETURNING id, session_id)
         INSERT INTO study_group_outbox (id, kind, dedupe_key, session_id, payload, status, created_at)
         SELECT $3, 'room_message', dead.id, dead.session_id,
           jsonb_build_object('room', dead.session_id, 'projectId', COALESCE(s.livekit_project_id, ''), 'text', '', 'messageId', dead.id, 'mode', 'unavailable'),
           'queued', NOW()
         FROM dead JOIN live_sessions s ON s.id = dead.session_id
         WHERE s.status = 'live'
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [claimed.id, input.leaseOwner, randomUUID()]
      );
      return attemptTutorClaim(input);
    }
    return claimed;
  }

  async function withdrawTutorRequest(input: { id: string; userId: string }): Promise<"withdrawn" | "answering" | "settled" | "not_found"> {
    await ensureSchema();
    // One conditional statement: only a queued row of the asker's settles, so
    // a claim racing the withdrawal either wins (the row is answered) or loses
    // (the row is withdrawn), never both.
    const withdrawn = await query<{ id: string }>(
      `UPDATE study_group_tutor_requests
       SET status = 'dead_letter', terminal_reason = 'withdrawn', next_attempt_at = NULL
       WHERE id = $1 AND user_id = $2 AND status = 'queued'
       RETURNING id`,
      [input.id, input.userId]
    );
    if (withdrawn.rows.length > 0) return "withdrawn";
    const current = await query<{ status: string }>("SELECT status FROM study_group_tutor_requests WHERE id = $1 AND user_id = $2", [input.id, input.userId]);
    const status = current.rows[0]?.status;
    if (!status) return "not_found";
    return status === "in_flight" ? "answering" : "settled";
  }

  async function settleTutorRequest(input: {
    id: string; leaseOwner: string;
    outcome: { status: "answered" | "dead_letter"; terminalReason: string };
    outbox?: TutorOutboxPayload;
  }) {
    await ensureSchema();
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const settled = await client.query<{ session_id: string }>(
        `UPDATE study_group_tutor_requests SET
           status = $3, terminal_reason = $4,
           answered_at = CASE WHEN $3 = 'answered' THEN NOW() ELSE answered_at END,
           outbox_message_id = $5,
           lease_owner = NULL, lease_expires_at = NULL, next_attempt_at = NULL
         WHERE id = $1 AND lease_owner = $2 AND status = 'in_flight'
         RETURNING session_id`,
        [input.id, input.leaseOwner, input.outcome.status, input.outcome.terminalReason, input.outbox?.messageId ?? null]
      );
      if ((settled.rowCount ?? 0) === 0) {
        // The lease was reclaimed while the answer was being produced; the
        // outcome is discarded and the new owner re-runs the item.
        await client.query("COMMIT");
        return;
      }
      if (input.outbox) {
        await client.query(
          `INSERT INTO study_group_outbox (id, kind, dedupe_key, session_id, payload, status, created_at)
           VALUES ($1, 'room_message', $2, $3, $4::jsonb, 'queued', NOW())
           ON CONFLICT (dedupe_key) DO NOTHING`,
          [randomUUID(), input.id, settled.rows[0].session_id, JSON.stringify(input.outbox)]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The connection is unusable; the original error is the real one.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function claimNextOutboxMessage(input: { sessionId: string; leaseOwner: string; leaseSeconds: number }): Promise<OutboxRow | null> {
    await ensureSchema();
    const result = await getPool().query<OutboxDbRow>(
      `UPDATE study_group_outbox SET
         status = 'sending', lease_owner = $1,
         lease_expires_at = NOW() + ($2::int * INTERVAL '1 second'),
         attempts = attempts + 1, next_attempt_at = NULL
       WHERE id = (
         SELECT id FROM study_group_outbox
         WHERE session_id = $3
           AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
           AND (status IN ('queued', 'failed') OR (status = 'sending' AND lease_expires_at <= NOW()))
         ORDER BY created_at, id
         LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
      [input.leaseOwner, input.leaseSeconds, input.sessionId]
    );
    return result.rows[0] ? mapOutbox(result.rows[0]) : null;
  }

  async function markOutboxDelivered(input: { id: string; leaseOwner: string }) {
    await query(
      `UPDATE study_group_outbox SET status = 'delivered', delivered_at = NOW(), lease_owner = NULL, lease_expires_at = NULL
       WHERE id = $1 AND lease_owner = $2 AND status = 'sending'`,
      [input.id, input.leaseOwner]
    );
  }

  async function markOutboxFailed(input: { id: string; leaseOwner: string; failureClass: string; maxAttempts: number; retryDelaySeconds: number }) {
    // A row that goes dead queues its one "unavailable" notice in the same
    // statement (QA M21); a dead notice queues nothing further.
    await query(
      `WITH failed AS (
         UPDATE study_group_outbox SET
           status = CASE WHEN attempts >= $5 THEN 'dead' ELSE 'failed' END,
           failure_class = $3,
           next_attempt_at = CASE WHEN attempts >= $5 THEN NULL ELSE NOW() + ($4::int * INTERVAL '1 second') END,
           lease_owner = NULL, lease_expires_at = NULL
         WHERE id = $1 AND lease_owner = $2 AND status = 'sending'
         RETURNING dedupe_key, session_id, payload, status)
       INSERT INTO study_group_outbox (id, kind, dedupe_key, session_id, payload, status, created_at)
       SELECT $6, 'room_message', failed.dedupe_key || ':unavailable', failed.session_id,
         failed.payload || jsonb_build_object('text', '', 'mode', 'unavailable'), 'queued', NOW()
       FROM failed
       WHERE failed.status = 'dead' AND COALESCE(failed.payload->>'mode', '') <> 'unavailable'
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [input.id, input.leaseOwner, input.failureClass, input.retryDelaySeconds, input.maxAttempts, randomUUID()]
    );
  }

  async function insertWebhookReceipt(input: { receiptId: string; eventType: string; sessionId: string | null; payload: unknown }): Promise<boolean> {
    // Mirror of the stripe_events rule: a duplicate receipt id returns false
    // and never writes a second row (design §1.4).
    const result = await query(
      `INSERT INTO study_group_webhook_receipts (receipt_id, event_type, session_id, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (receipt_id) DO NOTHING`,
      [input.receiptId, input.eventType, input.sessionId, JSON.stringify(input.payload ?? null)]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async function getWebhookReceipt(receiptId: string): Promise<WebhookReceiptRow | null> {
    const result = await query<WebhookReceiptDbRow>(
      "SELECT receipt_id, status, failure_class FROM study_group_webhook_receipts WHERE receipt_id = $1",
      [receiptId]
    );
    return result.rows[0] ? mapWebhookReceipt(result.rows[0]) : null;
  }

  // One UPDATE under the write lock instead of update()'s whole-store load
  // and diff (QA 2026-10-19 final review B3): heartbeats arrive every 10 s
  // from every seat holder. The lock keeps a concurrent update() from
  // writing back a stale last_seen_at it loaded before this renewal.
  async function renewSeat(input: { sessionId: string; userId: string; at: string; heldSince: string; startsBy: string }) {
    await ensureSchema();
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query(STUDY_GROUP_WRITE_LOCK);
      const result = await client.query(
        `UPDATE study_group_presences p SET last_seen_at = $3
          WHERE p.session_id = $1 AND p.user_id = $2 AND p.entered_at IS NOT NULL AND p.left_at IS NULL
            AND COALESCE(p.last_seen_at, p.entered_at) > $4
            AND EXISTS (SELECT 1 FROM live_sessions s WHERE s.id = p.session_id AND (s.status = 'live'
              OR (s.status = 'scheduled' AND s.starts_at <= $5 AND s.starts_at + s.duration_seconds * INTERVAL '1 second' > $3)))
          RETURNING p.id`,
        [input.sessionId, input.userId, input.at, input.heldSince, input.startsBy]
      );
      await client.query("COMMIT");
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The connection is unusable; the original error is the real one.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function markWebhookProcessed(input: { receiptId: string; result: "processed" | "ignored" | "failed"; failureClass?: string }) {
    await query(
      `UPDATE study_group_webhook_receipts SET status = $2, failure_class = $3, processed_at = NOW() WHERE receipt_id = $1`,
      [input.receiptId, input.result, input.failureClass ?? null]
    );
  }

  async function abandonStaleWebhookReceipts(input: { olderThanSeconds: number; limit: number }): Promise<number> {
    // Sweep A (design §4): one bounded statement. Receipts stuck in `received`
    // past the grace window become failed/abandoned so a crashed delivery is
    // visible to slice-3 dead-letter metrics instead of leaking silently; a
    // provider retry still resumes them (design §3), so no event is lost.
    const result = await query(
      `UPDATE study_group_webhook_receipts
       SET status = 'failed', failure_class = 'abandoned', processed_at = NOW()
       WHERE receipt_id IN (
         SELECT receipt_id FROM study_group_webhook_receipts
         WHERE status = 'received' AND received_at < NOW() - ($1::int * INTERVAL '1 second')
         ORDER BY received_at, receipt_id
         LIMIT $2
       )`,
      [input.olderThanSeconds, input.limit]
    );
    return result.rowCount ?? 0;
  }

  async function listLiveSessionsWithOpenPresences(limit: number): Promise<ReadonlyArray<{ id: string; liveKitProjectId: string | null }>> {
    // Sweep B (design §4): at most `limit` sessions in status `live` with an
    // open presence, oldest-observed first (started_at, then id) so a bounded
    // tick walks the backlog in a stable order.
    const result = await query<LiveSessionRefDbRow>(
      `SELECT ls.id, ls.livekit_project_id FROM live_sessions ls
       WHERE ls.status = 'live' AND ls.livekit_project_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM study_group_presences sp
           WHERE sp.session_id = ls.id AND sp.left_at IS NULL)
       ORDER BY ls.started_at ASC NULLS LAST, ls.id ASC
       LIMIT $1`,
      [limit]
    );
    return result.rows.map(mapLiveSessionRef);
  }

  async function listSessionsWithPendingTutorWork(input: { limit: number }): Promise<string[]> {
    await ensureSchema();
    const result = await getPool().query<{ session_id: string }>(
      `SELECT DISTINCT session_id FROM (
         SELECT session_id FROM study_group_tutor_requests
         WHERE (status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
            OR (status = 'in_flight' AND (lease_expires_at IS NULL OR lease_expires_at <= NOW()))
         UNION
         SELECT session_id FROM study_group_outbox
         WHERE (status IN ('queued', 'failed') AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
            OR (status = 'sending' AND (lease_expires_at IS NULL OR lease_expires_at <= NOW()))
       ) AS pending
       ORDER BY session_id
       LIMIT $1`,
      [input.limit]
    );
    return result.rows.map((row) => row.session_id);
  }

  async function studyGroupOperationalMetrics(): Promise<StudyGroupOperationalMetrics> {
    // Redacted operational counts (slice-3 design §5.2): one bounded aggregate
    // statement of scalar subselects over durable state. Counts and whole
    // seconds only — no identities, ids, or payloads leave this query; the
    // oldest queued age coalesces to 0 when nothing is queued.
    await ensureSchema();
    const result = await query<OperationalMetricsDbRow>(
      `SELECT
         (SELECT count(*) FROM study_group_tutor_requests WHERE status = 'queued') AS tutor_queued,
         (SELECT count(*) FROM study_group_tutor_requests WHERE status = 'in_flight') AS tutor_in_flight,
         (SELECT count(*) FROM study_group_tutor_requests WHERE status = 'dead_letter') AS tutor_dead_letter,
         (SELECT COALESCE(FLOOR(EXTRACT(EPOCH FROM (NOW() - MIN(received_at)))), 0)
            FROM study_group_tutor_requests WHERE status = 'queued') AS tutor_oldest_queued_age_seconds,
         (SELECT count(*) FROM study_group_webhook_receipts WHERE status = 'failed' AND failure_class = 'abandoned') AS webhook_abandoned,
         (SELECT count(*) FROM study_group_webhook_receipts WHERE status = 'failed') AS webhook_failed`
    );
    const row = result.rows[0];
    return {
      tutorQueued: Number(row.tutor_queued),
      tutorInFlight: Number(row.tutor_in_flight),
      tutorDeadLetter: Number(row.tutor_dead_letter),
      tutorOldestQueuedAgeSeconds: Number(row.tutor_oldest_queued_age_seconds),
      webhookAbandoned: Number(row.webhook_abandoned),
      webhookFailed: Number(row.webhook_failed)
    };
  }

  return {
    read,
    appendTokenLog,
    update,
    renewSeat,
    claimNextTutorRequest,
    settleTutorRequest,
    withdrawTutorRequest,
    claimNextOutboxMessage,
    markOutboxDelivered,
    markOutboxFailed,
    insertWebhookReceipt,
    getWebhookReceipt,
    markWebhookProcessed,
    abandonStaleWebhookReceipts,
    listLiveSessionsWithOpenPresences,
    listSessionsWithPendingTutorWork,
    studyGroupOperationalMetrics
  };
}

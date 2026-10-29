import { Pool, type QueryResultRow } from "pg";
import { readFileSync } from "node:fs";

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

export function postgresSsl(connectionString: string) {
  const disableSsl = process.env.DATABASE_SSL === "0" || /[?&]sslmode=disable\b/i.test(connectionString);
  if (disableSsl) return undefined;
  const caFile = process.env.DATABASE_CA_FILE?.trim();
  if (caFile) return { rejectUnauthorized: true as const, ca: readFileSync(caFile, "utf8") };
  // App Runner talks to RDS with Amazon's CA, which is not in Node's trust store.
  // Without DATABASE_CA_FILE, requiring verification throws "self-signed certificate in certificate chain".
  return { rejectUnauthorized: false as const };
}

export function getPool() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: postgresSsl(connectionString)
    });
  }
  return pool;
}

export async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = bootstrapSchema().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

// Distinct advisory-lock pair for the schema bootstrap (719301 is the payment
// aggregate's lock, 719302 the Study Group write lock): concurrent bootstraps
// — several instances cold-starting together, or a worker race in tests —
// serialize their DDL here instead of colliding in the catalog or deadlocking
// with each other and with live business transactions (the audit F-5 ALTER
// widened the batch's lock footprint, review 2026-10-14).
const SCHEMA_BOOTSTRAP_LOCK = 719303;
// The batch's DDL (ACCESS EXCLUSIVE on an existing table) must never wait
// indefinitely behind a business transaction: every lock wait in the
// attempt's transaction is bounded, and retryable lock failures
// (deadlock_detected 40P01, lock_not_available 55P03) are retried a bounded
// number of times. A process that still fails resets the memo above, so the
// next request re-runs the whole bootstrap.
const SCHEMA_BATCH_ATTEMPTS = 3;
const SCHEMA_LOCK_TIMEOUT_MS = 8000;

// Conservative freshness probe (fast path): every table the batch creates,
// plus the batch's newest additive column. When the batch grows, extend this
// probe in the same commit. A probe that under-promises only costs a batch
// re-run; one that over-promises would skip needed DDL — so err on the side
// of listing more. to_regclass and current_schemas() resolve through the
// same search_path the unqualified CREATEs use.
const SCHEMA_PROBE = `
  SELECT (
    to_regclass('contact_requests') IS NOT NULL
    AND to_regclass('helpdesk_ticket_counters') IS NOT NULL
    AND to_regclass('helpdesk_tickets') IS NOT NULL
    AND to_regclass('helpdesk_ticket_messages') IS NOT NULL
    AND to_regclass('helpdesk_attachments') IS NOT NULL
    AND to_regclass('helpdesk_ticket_events') IS NOT NULL
    AND to_regclass('helpdesk_ticket_tags') IS NOT NULL
    AND to_regclass('helpdesk_assist_log') IS NOT NULL
    AND to_regclass('helpdesk_ai_ratings') IS NOT NULL
    AND to_regclass('lesson_assessments') IS NOT NULL
    AND to_regclass('app_files') IS NOT NULL
    AND to_regclass('data_migrations') IS NOT NULL
    AND to_regclass('orm_rows') IS NOT NULL
    AND to_regclass('study_groups') IS NOT NULL
    AND to_regclass('study_group_memberships') IS NOT NULL
    AND to_regclass('live_sessions') IS NOT NULL
    AND to_regclass('study_group_attendance_intents') IS NOT NULL
    AND to_regclass('study_group_presences') IS NOT NULL
    AND to_regclass('study_group_meetings') IS NOT NULL
    AND to_regclass('study_group_reminders') IS NOT NULL
    AND to_regclass('study_group_tutor_requests') IS NOT NULL
    AND to_regclass('study_group_outbox') IS NOT NULL
    AND to_regclass('study_group_token_log') IS NOT NULL
    AND to_regclass('study_group_webhook_receipts') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'study_group_presences'
        AND column_name = 'livekit_participant_sid'
        AND table_schema = ANY (current_schemas(false))
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'study_group_presences'
        AND column_name = 'last_seen_at'
        AND table_schema = ANY (current_schemas(false))
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'helpdesk_tickets'
        AND column_name = 'flagged_at'
        AND table_schema = ANY (current_schemas(false))
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'helpdesk_assist_log'
        AND column_name = 'feedback_attempted_at'
        AND table_schema = ANY (current_schemas(false))
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'helpdesk_assist_log'
        AND column_name = 'alternatives'
        AND table_schema = ANY (current_schemas(false))
    )
    AND EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'live_sessions_duration_seconds_v2_check'
        AND conrelid = to_regclass('live_sessions')
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'live_sessions_duration_seconds_check'
        AND conrelid = to_regclass('live_sessions')
    )
  ) AS ready
`;

async function schemaIsCurrent(): Promise<boolean> {
  const result = await getPool().query<{ ready: boolean }>(SCHEMA_PROBE);
  return result.rows[0]?.ready === true;
}

function isRetryableSchemaLockError(error: unknown) {
  const code = (error as { code?: string }).code;
  return code === "40P01" || code === "55P03";
}

// One bootstrap attempt, one transaction: serialize behind the advisory lock,
// re-check the probe under the lock (a sibling instance may have finished
// while this attempt waited), then run the batch. Holding the lock for
// exactly the DDL's lifetime and releasing it on COMMIT/ROLLBACK keeps the
// serialization window as short as the DDL itself.
async function runSchemaBatchOnce(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // SET LOCAL before the advisory lock so every lock wait in this
    // transaction — including the bootstrap serialization itself — is bounded.
    await client.query(`SET LOCAL lock_timeout = '${SCHEMA_LOCK_TIMEOUT_MS}ms'`);
    await client.query("SELECT pg_advisory_xact_lock($1, 1)", [SCHEMA_BOOTSTRAP_LOCK]);
    const current = await client.query<{ ready: boolean }>(SCHEMA_PROBE);
    if (current.rows[0]?.ready === true) {
      await client.query("ROLLBACK");
      return;
    }
    await client.query(`
      -- Mirrors db/migrations/014_contact_requests.sql.
-- Additive and repeatable. Roll back application code first; retain this table
-- for support history. Drop only after an approved export/retention decision.
-- User-owned assessment participation, independent of Study/Entitlement.
CREATE TABLE IF NOT EXISTS lesson_assessments (
  user_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('knowledge', 'application')),
  version INTEGER NOT NULL CHECK (version > 0),
  last_event_id UUID NOT NULL UNIQUE,
  payload_hash CHAR(64) NOT NULL,
  record JSONB NOT NULL,
  PRIMARY KEY (user_id, course_id, lesson_id, kind)
);

CREATE TABLE IF NOT EXISTS contact_requests (
  id UUID PRIMARY KEY,
  client_event_id UUID NOT NULL UNIQUE,
  payload_hash CHAR(64) NOT NULL,
  user_id TEXT,
  first_name TEXT NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 50),
  last_name TEXT NOT NULL CHECK (char_length(last_name) BETWEEN 1 AND 50),
  email TEXT NOT NULL CHECK (char_length(email) BETWEEN 1 AND 254),
  phone TEXT NOT NULL DEFAULT '' CHECK (char_length(phone) <= 40),
  subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 5000),
  consent BOOLEAN NOT NULL CHECK (consent = TRUE),
  locale TEXT NOT NULL CHECK (locale IN ('en-GB', 'zh-CN')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS contact_requests_status_created_idx ON contact_requests (status, created_at DESC);

-- Mirrors db/migrations/017_helpdesk_tickets.sql (Helpdesk Tickets v1);
-- the two copies must declare the same tables, constraints and indexes
-- (pinned by tests/unit/helpdesk-migration.test.ts).
-- Per-day counter behind ticket numbers LG-YYMMDD-NNNN (UTC day).
CREATE TABLE IF NOT EXISTS helpdesk_ticket_counters (
  day TEXT PRIMARY KEY CHECK (day ~ '^[0-9]{6}$'),
  last INTEGER NOT NULL CHECK (last > 0)
);
CREATE TABLE IF NOT EXISTS helpdesk_tickets (
  id UUID PRIMARY KEY,
  number TEXT NOT NULL UNIQUE CHECK (number ~ '^LG-[0-9]{6}-[0-9]{4,}$'),
  user_id TEXT NOT NULL,
  user_email TEXT NOT NULL DEFAULT '' CHECK (char_length(user_email) <= 254),
  user_name TEXT NOT NULL DEFAULT '' CHECK (char_length(user_name) <= 120),
  contact_email TEXT NOT NULL CHECK (char_length(contact_email) BETWEEN 3 AND 254),
  locale TEXT NOT NULL CHECK (locale IN ('en-GB', 'zh-CN')),
  category TEXT NOT NULL CHECK (category IN ('technical_support', 'course_content', 'payments_subscriptions', 'other')),
  subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 120),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'ASSIGNED', 'WAITING_USER', 'PENDING_CONFIRM', 'CLOSED', 'CANCELLED')),
  assignee_id TEXT,
  assignee_name TEXT,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  confirm_due_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  close_reason TEXT CHECK (close_reason IN ('cancelled', 'user_confirmed', 'user_closed', 'auto_confirmed')),
  rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  last_message_at TIMESTAMPTZ NOT NULL,
  last_message_by TEXT NOT NULL CHECK (last_message_by IN ('learner', 'agent', 'system')),
  client_event_id UUID NOT NULL UNIQUE,
  payload_hash CHAR(64) NOT NULL,
  suggestion_id UUID,
  unread_by_agent BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS helpdesk_tickets_user_activity_idx ON helpdesk_tickets (user_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS helpdesk_tickets_activity_idx ON helpdesk_tickets (updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS helpdesk_tickets_status_activity_idx ON helpdesk_tickets (status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS helpdesk_tickets_confirm_due_idx ON helpdesk_tickets (confirm_due_at) WHERE status = 'PENDING_CONFIRM';
CREATE TABLE IF NOT EXISTS helpdesk_ticket_messages (
  id UUID PRIMARY KEY,
  ticket_id UUID NOT NULL REFERENCES helpdesk_tickets(id),
  author_kind TEXT NOT NULL CHECK (author_kind IN ('learner', 'agent', 'system')),
  author_id TEXT,
  author_name TEXT,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  internal BOOLEAN NOT NULL DEFAULT FALSE,
  attachment_ids UUID[] NOT NULL DEFAULT '{}' CHECK (cardinality(attachment_ids) <= 5),
  client_event_id UUID UNIQUE,
  payload_hash CHAR(64),
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS helpdesk_ticket_messages_ticket_idx ON helpdesk_ticket_messages (ticket_id, created_at, id);
CREATE TABLE IF NOT EXISTS helpdesk_attachments (
  id UUID PRIMARY KEY,
  ticket_id UUID NOT NULL REFERENCES helpdesk_tickets(id),
  message_id UUID NOT NULL REFERENCES helpdesk_ticket_messages(id),
  uploader_kind TEXT NOT NULL CHECK (uploader_kind IN ('learner', 'agent')),
  file_name TEXT NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/csv', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  storage_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS helpdesk_attachments_ticket_idx ON helpdesk_attachments (ticket_id);
-- CloudEvents 1.0 field names. One row per accepted command. client_event_id
-- carries the Idempotency-Key of the command that produced the event.
CREATE TABLE IF NOT EXISTS helpdesk_ticket_events (
  id UUID PRIMARY KEY,
  specversion TEXT NOT NULL DEFAULT '1.0' CHECK (specversion = '1.0'),
  source TEXT NOT NULL DEFAULT '/portal/helpdesk',
  type TEXT NOT NULL CHECK (type LIKE 'com.ilovelearningguide.helpdesk.ticket.%'),
  subject UUID NOT NULL REFERENCES helpdesk_tickets(id),
  time TIMESTAMPTZ NOT NULL,
  datacontenttype TEXT NOT NULL DEFAULT 'application/json',
  data JSONB NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  client_event_id UUID UNIQUE,
  payload_hash CHAR(64),
  UNIQUE (subject, sequence)
);
CREATE TABLE IF NOT EXISTS helpdesk_ticket_tags (
  ticket_id UUID NOT NULL REFERENCES helpdesk_tickets(id),
  tag TEXT NOT NULL CHECK (char_length(tag) BETWEEN 1 AND 32),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (ticket_id, tag)
);
CREATE INDEX IF NOT EXISTS helpdesk_ticket_tags_tag_idx ON helpdesk_ticket_tags (tag);

-- Mirrors db/migrations/018_helpdesk_v2.sql (Helpdesk v2: flag + AI assist
-- log); same parity rule as 017 above.
ALTER TABLE helpdesk_tickets ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMPTZ;
ALTER TABLE helpdesk_tickets ADD COLUMN IF NOT EXISTS flagged_by TEXT;
CREATE INDEX IF NOT EXISTS helpdesk_tickets_flagged_idx ON helpdesk_tickets (updated_at DESC, id DESC) WHERE flagged_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS helpdesk_assist_log (
  id UUID PRIMARY KEY,
  learner_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('submit', 'chat', 'chip')),
  locale TEXT NOT NULL CHECK (locale IN ('en-GB', 'zh-CN')),
  question TEXT NOT NULL CHECK (char_length(question) BETWEEN 1 AND 500),
  faq_id UUID,
  faq_question TEXT CHECK (char_length(faq_question) <= 200),
  answer TEXT CHECK (char_length(answer) <= 4000),
  feedback TEXT CHECK (feedback IN ('helpful', 'not_helpful', 'solved', 'declined', 'edited')),
  ticket_id UUID REFERENCES helpdesk_tickets(id),
  client_event_id UUID UNIQUE,
  payload_hash CHAR(64),
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS helpdesk_assist_log_learner_idx ON helpdesk_assist_log (learner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS helpdesk_assist_log_ticket_idx ON helpdesk_assist_log (ticket_id, created_at, id) WHERE ticket_id IS NOT NULL;

-- Mirrors db/migrations/019_helpdesk_outcome_delivery.sql (whether Admin
-- confirmed an assist outcome); same parity rule as 017 above.
ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS feedback_delivered_at TIMESTAMPTZ;
ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS feedback_attempted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS helpdesk_assist_log_undelivered_idx ON helpdesk_assist_log (feedback_attempted_at NULLS FIRST, created_at, id) WHERE feedback IS NOT NULL AND feedback_delivered_at IS NULL;

-- Mirrors db/migrations/020_helpdesk_ai_ratings.sql (the AI service rating
-- and the offered alternatives); same parity rule as 017 above.
CREATE TABLE IF NOT EXISTS helpdesk_ai_ratings (
  run_id UUID PRIMARY KEY REFERENCES helpdesk_assist_log(id),
  learner_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('submit', 'chat', 'chip')),
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS alternatives JSONB;

      CREATE TABLE IF NOT EXISTS app_files (
          path TEXT PRIMARY KEY,
          storage TEXT NOT NULL CHECK (storage IN ('db', 's3')),
          content TEXT,
          s3_key TEXT,
          byte_size INTEGER NOT NULL DEFAULT 0,
          content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS app_files_path_prefix_idx ON app_files (path text_pattern_ops);
        CREATE TABLE IF NOT EXISTS data_migrations (
          id TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS orm_rows (
          table_name TEXT NOT NULL,
          id TEXT NOT NULL,
          payload JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (table_name, id)
        );
        -- Mirrors db/migrations/012_study_group_persistence.sql so a boot with
        -- no schema job self-heals (010 precedent); the two copies must
        -- declare the same tables and constraints
        -- (pinned by tests/unit/study-group-migration-parity.test.ts).
        CREATE TABLE IF NOT EXISTS study_groups (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          course_id TEXT NOT NULL,
          about TEXT NOT NULL,
          host_user_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'cancelled')),
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS study_group_memberships (
          id TEXT PRIMARY KEY,
          group_id TEXT NOT NULL REFERENCES study_groups(id),
          user_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('host', 'member')),
          joined_at TIMESTAMPTZ NOT NULL,
          left_at TIMESTAMPTZ,
          UNIQUE (group_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS study_group_memberships_active_user_idx
          ON study_group_memberships (user_id) WHERE left_at IS NULL;
        CREATE TABLE IF NOT EXISTS live_sessions (
          id TEXT PRIMARY KEY,
          group_id TEXT NOT NULL REFERENCES study_groups(id),
          title TEXT NOT NULL,
          related_lesson_id TEXT,
          starts_at TIMESTAMPTZ NOT NULL,
          duration_seconds INTEGER NOT NULL CHECK (duration_seconds IN (1800, 2700, 3600, 5400)),
          max_participants INTEGER NOT NULL CHECK (max_participants BETWEEN 2 AND 6),
          focus TEXT,
          ai_tutor_enabled BOOLEAN NOT NULL,
          livekit_project_id TEXT,                -- immutable once provisioning was attempted / live
          status TEXT NOT NULL CHECK (status IN ('scheduled', 'live', 'completed', 'removed')),
          occupancy INTEGER NOT NULL DEFAULT 0 CHECK (occupancy >= 0),
          started_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL,
          CHECK (occupancy <= max_participants)   -- capacity backstop (hazard 1)
        );
        CREATE INDEX IF NOT EXISTS live_sessions_group_idx ON live_sessions (group_id);
        -- 10/20/30/40-minute Sessions (owner 2026-10-29), keeping the earlier
        -- 45/60/90 for stored rows: swap 012's column CHECK for a named wider
        -- one. Idempotent boot self-heal mirroring
        -- db/migrations/021_live_session_short_durations.sql.
        ALTER TABLE live_sessions DROP CONSTRAINT IF EXISTS live_sessions_duration_seconds_check;
        ALTER TABLE live_sessions DROP CONSTRAINT IF EXISTS live_sessions_duration_seconds_v2_check;
        ALTER TABLE live_sessions ADD CONSTRAINT live_sessions_duration_seconds_v2_check
          CHECK (duration_seconds IN (600, 1200, 1800, 2400, 2700, 3600, 5400));
        CREATE TABLE IF NOT EXISTS study_group_attendance_intents (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES live_sessions(id),
          user_id TEXT NOT NULL,
          planned_at TIMESTAMPTZ NOT NULL,
          cancelled_at TIMESTAMPTZ,
          UNIQUE (session_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS study_group_presences (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES live_sessions(id),
          user_id TEXT NOT NULL,
          requested_at TEXT NOT NULL,             -- "<ISO>#00000001" receipt string (enter route)
          entered_at TIMESTAMPTZ,
          left_at TIMESTAMPTZ,
          phase TEXT NOT NULL CHECK (phase IN ('waiting', 'live')),
          livekit_participant_sid TEXT,           -- legacy (audit F-5), no longer written
          last_seen_at TIMESTAMPTZ,               -- seat lease: last entry or heartbeat (016)
          UNIQUE (session_id, user_id)            -- one row per user+session; re-entry flips left_at
        );
        CREATE INDEX IF NOT EXISTS study_group_presences_seated_idx
          ON study_group_presences (session_id) WHERE entered_at IS NOT NULL AND left_at IS NULL;
        -- Audit F-5: add the seat's current LiveKit connection id to databases
        -- whose study_group_presences predates the column (the CREATE above
        -- only fires on a fresh table); idempotent boot self-heal mirroring
        -- db/migrations/013_study_group_presence_connection_sid.sql.
        ALTER TABLE study_group_presences ADD COLUMN IF NOT EXISTS livekit_participant_sid TEXT;
        -- Seat lease (QA 2026-10-19 redesign): same idempotent self-heal,
        -- mirroring db/migrations/016_study_group_presence_last_seen.sql.
        ALTER TABLE study_group_presences ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
        CREATE TABLE IF NOT EXISTS study_group_meetings (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES live_sessions(id),
          started_at TIMESTAMPTZ NOT NULL,
          ended_at TIMESTAMPTZ,
          UNIQUE (session_id)                     -- one meeting row per session
        );
        CREATE TABLE IF NOT EXISTS study_group_reminders (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES live_sessions(id),
          user_id TEXT NOT NULL,
          sent_at TIMESTAMPTZ NOT NULL,
          UNIQUE (session_id, user_id)            -- reminder de-dup (hazard 4)
        );
        CREATE TABLE IF NOT EXISTS study_group_tutor_requests (
          id TEXT PRIMARY KEY,
          seq BIGSERIAL NOT NULL,                 -- receipt order tie-break (received_at + seq)
          session_id TEXT NOT NULL REFERENCES live_sessions(id),
          user_id TEXT NOT NULL,
          client_event_id TEXT NOT NULL,
          text TEXT NOT NULL,
          received_at TIMESTAMPTZ NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('queued', 'in_flight', 'answered', 'dead_letter')),
          lease_owner TEXT,
          lease_expires_at TIMESTAMPTZ,           -- claim lease (60 s)
          next_attempt_at TIMESTAMPTZ,            -- retry schedule / claimable-at; NULL = claimable now
          attempts INTEGER NOT NULL DEFAULT 0,
          terminal_reason TEXT,                   -- 'answered' | 'model_failed' | 'attempts_exhausted' (legacy rows may carry 'course_material_absent')
          outbox_message_id TEXT,                 -- set when an answer was handed to the outbox
          answered_at TIMESTAMPTZ,
          UNIQUE (session_id, user_id, client_event_id)   -- enqueue idempotency (external id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS study_group_tutor_requests_single_flight_uidx
          ON study_group_tutor_requests (session_id) WHERE status = 'in_flight';  -- one in-flight per session (hazard 2)
        CREATE INDEX IF NOT EXISTS study_group_tutor_requests_claim_idx
          ON study_group_tutor_requests (session_id, status, received_at, seq);
        CREATE TABLE IF NOT EXISTS study_group_outbox (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('room_message')),  -- later slices extend the CHECK
          dedupe_key TEXT NOT NULL UNIQUE,        -- tutor request id == LiveKit messageId
          session_id TEXT NOT NULL REFERENCES live_sessions(id),
          payload JSONB NOT NULL,                 -- { room, projectId, text, messageId, mode } ('mode' optional on legacy rows)
          status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'delivered', 'failed', 'dead')),
          attempts INTEGER NOT NULL DEFAULT 0,
          lease_owner TEXT,
          lease_expires_at TIMESTAMPTZ,
          next_attempt_at TIMESTAMPTZ,
          failure_class TEXT,                     -- redacted gateway failure code
          created_at TIMESTAMPTZ NOT NULL,
          delivered_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS study_group_outbox_claim_idx
          ON study_group_outbox (status, next_attempt_at);
        CREATE TABLE IF NOT EXISTS study_group_token_log (
          id BIGSERIAL PRIMARY KEY,               -- append-only; replaces token-issuance.log
          line TEXT NOT NULL,                     -- encrypted issuance line, no token, no secret
          issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS study_group_webhook_receipts (
          receipt_id TEXT PRIMARY KEY,            -- provider receipt id (unique receipt id)
          event_type TEXT NOT NULL,
          session_id TEXT,                        -- resolved room name at processing time (slice 2)
          payload JSONB NOT NULL,
          status TEXT NOT NULL DEFAULT 'received'
            CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
          failure_class TEXT,
          received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          processed_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS study_group_webhook_receipts_received_idx
          ON study_group_webhook_receipts (received_at);
      `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function bootstrapSchema(): Promise<void> {
  // Fast path: a current schema is answered by one cheap probe query, with no
  // DDL, no advisory lock, and therefore no lock interaction with live traffic
  // on every process start.
  if (await schemaIsCurrent()) return;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await runSchemaBatchOnce();
      return;
    } catch (error) {
      if (!isRetryableSchemaLockError(error) || attempt >= SCHEMA_BATCH_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) {
  await ensureSchema();
  return getPool().query<T>(text, params);
}

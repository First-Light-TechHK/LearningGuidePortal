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
    schemaReady = (async () => {
      const client = getPool();
      await client.query(`
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
        CREATE TABLE IF NOT EXISTS wechat_login_tickets (
          ticket_hash CHAR(64) PRIMARY KEY,
          target_env TEXT NOT NULL CHECK (target_env IN ('DEV', 'SIT', 'UAT')),
          nonce TEXT NOT NULL,
          profile JSONB NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS wechat_login_tickets_expires_at_idx ON wechat_login_tickets (expires_at);
        -- Mirrors db/migrations/012_study_group_persistence.sql so a boot with
        -- no schema job self-heals (010/011 precedent); the two copies must
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
          UNIQUE (session_id, user_id)            -- one row per user+session; re-entry flips left_at
        );
        CREATE INDEX IF NOT EXISTS study_group_presences_seated_idx
          ON study_group_presences (session_id) WHERE entered_at IS NOT NULL AND left_at IS NULL;
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
          terminal_reason TEXT,                   -- 'answered' | 'course_material_absent' | 'model_failed' | 'attempts_exhausted'
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
          payload JSONB NOT NULL,                 -- { room, projectId, text, messageId }
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
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) {
  await ensureSchema();
  return getPool().query<T>(text, params);
}

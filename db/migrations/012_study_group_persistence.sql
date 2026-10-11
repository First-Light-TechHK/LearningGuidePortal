-- Study Group production store (Phase C slice 1). Apply before enabling the
-- PostgreSQL Study Group store (STUDY_GROUP_STORE=postgres) in any environment.
-- Every constraint below is a release-gate guarantee from
-- docs/phase1/study-group/study-group-architecture.md § Atomic steps.
-- Timestamps are TIMESTAMPTZ; the repository maps ISO-8601 strings.

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

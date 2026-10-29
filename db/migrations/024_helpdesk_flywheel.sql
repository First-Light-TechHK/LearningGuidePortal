-- Helpdesk v5 Part G (helpdesk-v5-context-chips-and-smalltalk.md G1/G2 and
-- helpdesk-v5-faq-graph-design.md §3, 2026-10-29): the data flywheel's
-- capture and clean steps on Portal, the single writer of learner text.
-- helpdesk_assist_log.scrubbed_at: when the 180-day retention job replaced
-- the row's raw learner text (question, and the short strings shown) with the
-- code-only scrubber's output (modules/helpdesk/piiScrubber.ts); null = still
-- the raw text. Nullable, no default: every existing row reads as raw.
-- helpdesk_job_runs: one row per run of a Portal background job (today only
-- the retention job): at most one scheduled run per job and UTC day (the
-- partial unique index), and a staff "run now" is idempotent by its
-- Idempotency-Key (client_event_id). Observable: status, attempts, start and
-- end, cutoff, rows changed, whether more were due, the error code (never a
-- message) and, for a manual run, the staff member who asked.
-- helpdesk_assist_outcomes: the ticket outcome of every assist log row, read
-- from the tickets and their messages (no copy of either, so there is one
-- source of truth): the ticket the row was linked to, otherwise the learner's
-- next enquiry opened within 24 hours after the row; its status and close
-- reason; whether an agent resolved it (the learner confirmed the agent's
-- proposed resolution, or it auto-confirmed); and the agent's last public
-- reply on it.
-- The two indexes page the insights feed and the retention job by
-- (created_at, id); the ticket index finds the next enquiry of a learner.
-- Additive and repeatable; 017-023 are never edited (021 is Study Groups').
-- services/persistence/db.ts mirrors every statement in the startup bootstrap
-- and the freshness probe (parity pinned by tests/unit/helpdesk-migration.test.ts),
-- so it runs on deploy like the earlier helpdesk migrations.
-- Rollback: roll the application back first, then (only after an approved
-- export/retention decision) DROP VIEW helpdesk_assist_outcomes, DROP TABLE
-- helpdesk_job_runs, the six indexes and ALTER TABLE helpdesk_assist_log
-- DROP COLUMN scrubbed_at. Text already scrubbed stays scrubbed.
ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS scrubbed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS helpdesk_assist_log_created_idx ON helpdesk_assist_log (created_at, id);
CREATE INDEX IF NOT EXISTS helpdesk_assist_log_retention_idx ON helpdesk_assist_log (created_at, id) WHERE scrubbed_at IS NULL;
CREATE INDEX IF NOT EXISTS helpdesk_tickets_user_created_idx ON helpdesk_tickets (user_id, created_at, id);
CREATE INDEX IF NOT EXISTS helpdesk_ticket_messages_agent_reply_idx ON helpdesk_ticket_messages (ticket_id, created_at DESC, id DESC) WHERE author_kind = 'agent' AND internal = FALSE;
CREATE TABLE IF NOT EXISTS helpdesk_job_runs (
  id UUID PRIMARY KEY,
  job TEXT NOT NULL CHECK (job IN ('assist_retention')),
  run_day DATE NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('schedule', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  attempts SMALLINT NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  cutoff TIMESTAMPTZ NOT NULL,
  rows_scrubbed INTEGER NOT NULL DEFAULT 0 CHECK (rows_scrubbed >= 0),
  more_due BOOLEAN NOT NULL DEFAULT FALSE,
  instance TEXT CHECK (char_length(instance) <= 120),
  requested_by_id TEXT CHECK (char_length(requested_by_id) BETWEEN 1 AND 128),
  requested_by_name TEXT CHECK (char_length(requested_by_name) <= 120),
  client_event_id UUID UNIQUE,
  error_code TEXT CHECK (char_length(error_code) <= 64),
  CHECK ((trigger = 'manual') = (requested_by_id IS NOT NULL)),
  CHECK ((status = 'running') = (finished_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS helpdesk_job_runs_daily_idx ON helpdesk_job_runs (job, run_day) WHERE trigger = 'schedule';
CREATE INDEX IF NOT EXISTS helpdesk_job_runs_recent_idx ON helpdesk_job_runs (job, started_at DESC, id DESC);
CREATE OR REPLACE VIEW helpdesk_assist_outcomes AS SELECT a.id AS assist_id,
    t.id AS ticket_id,
    (a.ticket_id IS NOT NULL) AS ticket_linked,
    t.created_at AS ticket_created_at,
    t.status AS ticket_status,
    t.close_reason,
    t.closed_at,
    COALESCE(t.close_reason IN ('user_confirmed', 'auto_confirmed'), FALSE) AS resolved_by_agent,
    r.id AS agent_reply_id,
    r.created_at AS agent_reply_at
  FROM helpdesk_assist_log a
  LEFT JOIN LATERAL (
    (SELECT x.id, x.created_at, x.status, x.close_reason, x.closed_at FROM helpdesk_tickets x WHERE x.id = a.ticket_id)
    UNION ALL
    (SELECT y.id, y.created_at, y.status, y.close_reason, y.closed_at FROM helpdesk_tickets y
      WHERE a.ticket_id IS NULL AND y.user_id = a.learner_id AND y.created_at >= a.created_at AND y.created_at < a.created_at + INTERVAL '24 hours'
      ORDER BY y.created_at, y.id LIMIT 1)
  ) t ON TRUE
  LEFT JOIN LATERAL (
    SELECT m.id, m.created_at FROM helpdesk_ticket_messages m
    WHERE m.ticket_id = t.id AND m.author_kind = 'agent' AND m.internal = FALSE
    ORDER BY m.created_at DESC, m.id DESC LIMIT 1
  ) r ON TRUE;

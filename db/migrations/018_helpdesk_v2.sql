-- Helpdesk v2 (docs/phase1/helpdesk-tickets.md §13, tickets-v2-figma-addendum §4a).
-- Additive and repeatable; 017 is never edited. Portal stays the single writer.
-- services/persistence/db.ts mirrors every statement in the startup bootstrap
-- and the freshness probe (parity pinned by tests/unit/helpdesk-migration.test.ts).
-- Rollback: roll the application back first, then (only after an approved
-- export/retention decision) DROP TABLE helpdesk_assist_log and
-- ALTER TABLE helpdesk_tickets DROP COLUMN flagged_at, DROP COLUMN flagged_by.
-- "Flag follow-up" in the BackOffice action bar: when and by which agent.
ALTER TABLE helpdesk_tickets ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMPTZ;
ALTER TABLE helpdesk_tickets ADD COLUMN IF NOT EXISTS flagged_by TEXT;
CREATE INDEX IF NOT EXISTS helpdesk_tickets_flagged_idx ON helpdesk_tickets (updated_at DESC, id DESC) WHERE flagged_at IS NOT NULL;
-- Every AI Support Assistant answer shown to a learner (chat, starter chip,
-- submit-time modal), the verbatim text shown, the learner's feedback and the
-- ticket it was later linked to. id is Admin's suggestion id, or a Portal
-- UUIDv7 when Admin had no answer. client_event_id is the chat request's
-- Idempotency-Key.
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

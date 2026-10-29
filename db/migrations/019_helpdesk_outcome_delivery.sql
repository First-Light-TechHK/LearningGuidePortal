-- Helpdesk v2 follow-up (docs/phase1/helpdesk-tickets.md §16): remember
-- whether Admin confirmed a learner's assist outcome, so one Admin outage no
-- longer loses it. Portal stores the outcome first-wins (helpdesk_assist_log
-- .feedback) and forwards it; a row with feedback but no delivered time is
-- retried by the sweep (least recently tried first). Additive and
-- repeatable; 017 and 018 are never edited. services/persistence/db.ts
-- mirrors every statement (parity pinned by tests/unit/helpdesk-migration.test.ts).
-- Rollback: roll the application back first, then DROP INDEX
-- helpdesk_assist_log_undelivered_idx and DROP the two columns.
ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS feedback_delivered_at TIMESTAMPTZ;
ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS feedback_attempted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS helpdesk_assist_log_undelivered_idx ON helpdesk_assist_log (feedback_attempted_at NULLS FIRST, created_at, id) WHERE feedback IS NOT NULL AND feedback_delivered_at IS NULL;

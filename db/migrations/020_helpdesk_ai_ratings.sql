-- Helpdesk v3 (helpdesk-v3-alternatives-rating.md, 2026-10-29): the AI
-- service rating card ("How was this help?", 1-5 stars or Skip) and the
-- "You might be asking" alternatives shown with a missing answer.
-- helpdesk_ai_ratings holds one rating per answer the learner was shown:
-- run_id is the helpdesk_assist_log row (the submit-time suggestion or the
-- chosen alternative's chip answer), so the first rating wins and a repeat is
-- idempotent; Skip stores nothing. helpdesk_assist_log.alternatives keeps what
-- Admin offered with a no-answer row, so an Idempotency-Key replay shows the
-- same chips (null on rows written before v3 reads as none).
-- Additive and repeatable; 017, 018 and 019 are never edited.
-- services/persistence/db.ts mirrors every statement in the startup bootstrap
-- and the freshness probe (parity pinned by tests/unit/helpdesk-migration.test.ts),
-- so it runs on deploy like the earlier helpdesk migrations.
-- Rollback: roll the application back first, then (only after an approved
-- export/retention decision) DROP TABLE helpdesk_ai_ratings and
-- ALTER TABLE helpdesk_assist_log DROP COLUMN alternatives.
CREATE TABLE IF NOT EXISTS helpdesk_ai_ratings (
  run_id UUID PRIMARY KEY REFERENCES helpdesk_assist_log(id),
  learner_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('submit', 'chat', 'chip')),
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS alternatives JSONB;

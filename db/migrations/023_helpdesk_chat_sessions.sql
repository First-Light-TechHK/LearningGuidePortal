-- Helpdesk v5 (helpdesk-v5-faq-graph-design.md §3 and
-- helpdesk-v5-context-chips-and-smalltalk.md Part G1, 2026-10-29): the
-- learner's chat sessions and, on every assist log row, the turn's place in
-- its session and what it was (enum names only), so a conversation can be
-- rebuilt as a path (entry -> option B -> follow-up 2 -> handover).
-- helpdesk_chat_sessions: one row per chat session, written only by Portal.
-- current_node_id is the card on screen; signals are the learner's situation
-- signals (Part A enum names, never values) when the session started.
-- helpdesk_assist_log gains nullable columns: every row written before v5
-- (and every submit-time check) reads as "no session". texts keeps the short
-- strings shown with the card so an Idempotency-Key replay shows the same;
-- covered is the clarify outcome.
-- Additive and repeatable; 017-022 are never edited (021 is Study Groups').
-- services/persistence/db.ts mirrors every statement in the startup bootstrap
-- and the freshness probe (parity pinned by tests/unit/helpdesk-migration.test.ts),
-- so it runs on deploy like the earlier helpdesk migrations.
-- Rollback: roll the application back first, then (only after an approved
-- export/retention decision) ALTER TABLE helpdesk_assist_log DROP COLUMN for
-- each column below and DROP TABLE helpdesk_chat_sessions.
CREATE TABLE IF NOT EXISTS helpdesk_chat_sessions (
  id UUID PRIMARY KEY,
  learner_id TEXT NOT NULL,
  locale TEXT NOT NULL CHECK (locale IN ('en-GB', 'zh-CN')),
  release_version INTEGER CHECK (release_version IS NULL OR release_version >= 1),
  started_at TIMESTAMPTZ NOT NULL,
  last_turn_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  end_reason TEXT CHECK (end_reason IN ('idle', 'ended_by_learner', 'handover', 'ticket')),
  turns SMALLINT NOT NULL DEFAULT 0 CHECK (turns >= 0),
  unsolved_streak SMALLINT NOT NULL DEFAULT 0 CHECK (unsolved_streak >= 0),
  current_node_id UUID,
  signals TEXT[] NOT NULL DEFAULT '{}' CHECK (signals <@ ARRAY['trial_ending', 'payment_failed', 'payment_pending', 'recent_purchase', 'subscription_cancelled', 'subscription_expired', 'email_unverified', 'open_ticket_waiting', 'from_order']::text[]),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS helpdesk_chat_sessions_learner_idx ON helpdesk_chat_sessions (learner_id, last_turn_at DESC);
ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES helpdesk_chat_sessions(id);
ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS turn_index SMALLINT CHECK (turn_index IS NULL OR turn_index >= 1);
ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS node_id UUID;
ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS parent_node_id UUID;
ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS via TEXT CHECK (via IN ('typed', 'follow_up', 'option', 'starter', 'signal', 'alternative'));
ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS kind TEXT CHECK (kind IN ('answer', 'smalltalk', 'clarify', 'no_match', 'handover'));
ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS intent TEXT CHECK (intent IN ('question', 'own_account', 'someone_else', 'exception', 'private_data', 'instructions', 'off_topic', 'greeting', 'farewell', 'vague', 'clarify'));
ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS guard TEXT CHECK (guard IN ('passed', 'fallback', 'missing', 'too_long', 'link', 'email', 'digit', 'markup', 'blocked_phrase', 'ai_filler', 'script', 'ungrounded', 'not_covered', 'timeout', 'error'));
ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS release_version INTEGER CHECK (release_version IS NULL OR release_version >= 1);
ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS trace_id TEXT CHECK (trace_id ~ '^[0-9a-f]{32}$');
ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS signals TEXT[] CHECK (signals <@ ARRAY['trial_ending', 'payment_failed', 'payment_pending', 'recent_purchase', 'subscription_cancelled', 'subscription_expired', 'email_unverified', 'open_ticket_waiting', 'from_order']::text[]);
ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS blocks TEXT[] CHECK (cardinality(blocks) <= 3);
ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS expanded BOOLEAN;
ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS covered BOOLEAN;
ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS texts JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS helpdesk_assist_log_session_turn_idx ON helpdesk_assist_log (session_id, turn_index) WHERE session_id IS NOT NULL;

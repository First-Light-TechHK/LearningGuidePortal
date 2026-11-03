-- Helpdesk rate limiting (backend review 2026-11-03, M2): the learner-side
-- hourly limits (new enquiries, learner messages, assistant questions, submit
-- checks) were counted from the stored rows: count, then insert, with no lock
-- between the two, so requests racing each other could pass a limit. This
-- table records one row per attempt the limit admitted; the repository takes a
-- transaction-level advisory lock on the key, deletes the hits outside the
-- window, counts, and inserts, all in one transaction, so the count is exact
-- across instances. Keys are "<limit>:<learner id>"; rows outside the window
-- are deleted on the next attempt with that key, so the table stays small.
-- Additive and repeatable; mirrored in services/persistence/db.ts (bootstrap
-- and probe); pinned by tests/unit/helpdesk-migration.test.ts. 017-025 are not
-- edited. Rollback: roll back the application and retain the table (an older
-- Portal counts from the rows again and ignores it).
CREATE TABLE IF NOT EXISTS helpdesk_rate_hits (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL CHECK (char_length(key) BETWEEN 1 AND 160),
  hit_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS helpdesk_rate_hits_key_idx ON helpdesk_rate_hits (key, hit_at);

-- app_files (persistence review 2026-11-03, F1): the file store table was
-- declared only by the services/persistence/db.ts bootstrap and never by a
-- migration, so a database built from this chain alone never satisfied the
-- boot freshness probe (to_regclass('app_files')) and every first process
-- start on it took the DDL path once. This file mirrors the bootstrap block
-- verbatim so the chain and the bootstrap describe the same schema.
-- Additive and repeatable (IF NOT EXISTS); pinned by
-- tests/io/postgres/schema-fresh-vs-migrations.test.ts. 017-027 are not
-- edited. Rollback: none needed (an older Portal creates the same table).
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

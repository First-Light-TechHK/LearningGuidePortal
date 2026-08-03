-- Applied automatically by the app on first DB connection (services/persistence/db.ts).
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

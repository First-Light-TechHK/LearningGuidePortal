-- Runtime tables the AWS boot adapter uses when it compiles MigrationOrm ops.
-- App Runner also CREATE TABLE IF NOT EXISTS these in ensureOrmRuntime so DEV/SIT
-- persist does not depend on a separate schema job.
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

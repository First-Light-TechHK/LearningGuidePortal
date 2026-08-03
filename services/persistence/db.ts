import { Pool, type QueryResultRow } from "pg";

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

export function getPool() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  if (!pool) {
    const disableSsl = process.env.DATABASE_SSL === "0" || /[?&]sslmode=disable\b/i.test(connectionString);
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: disableSsl ? undefined : { rejectUnauthorized: false }
    });
  }
  return pool;
}

export async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = getPool();
      await client.query(`
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
      `);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) {
  await ensureSchema();
  return getPool().query<T>(text, params);
}

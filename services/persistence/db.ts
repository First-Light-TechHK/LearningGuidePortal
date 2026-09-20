import { Pool, type QueryResultRow } from "pg";
import { readFileSync } from "node:fs";

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

export function postgresSsl(connectionString: string) {
  const disableSsl = process.env.DATABASE_SSL === "0" || /[?&]sslmode=disable\b/i.test(connectionString);
  if (disableSsl) return undefined;
  const caFile = process.env.DATABASE_CA_FILE?.trim();
  if (caFile) return { rejectUnauthorized: true as const, ca: readFileSync(caFile, "utf8") };
  // App Runner talks to RDS with Amazon's CA, which is not in Node's trust store.
  // Without DATABASE_CA_FILE, requiring verification throws "self-signed certificate in certificate chain".
  return { rejectUnauthorized: false as const };
}

export function getPool() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: postgresSsl(connectionString)
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

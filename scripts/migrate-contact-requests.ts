import { loadEnvConfig } from "@next/env";
import { ensureSchema, getPool } from "../services/persistence/db";

// No data writes by default. --apply performs the additive schema bootstrap.
async function main() {
  if (!process.argv.includes("--apply")) {
    console.log("Dry run: create contact_requests and its unique client_event_id/status-date indexes (db/migrations/014_contact_requests.sql). Run with --apply to migrate the configured PostgreSQL database.");
    return;
  }
  loadEnvConfig(process.cwd());
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required.");
  try { await ensureSchema(); console.log("Contact requests schema is ready (014_contact_requests.sql)."); }
  finally { await getPool().end(); }
}
main().catch(() => { console.error("Contact requests migration failed; check database configuration and migration permissions."); process.exitCode = 1; });

import { loadEnvConfig } from "@next/env";
import { ensureSchema, getPool } from "../services/persistence/db";

// No data writes by default. --apply performs the additive schema bootstrap.
async function main() {
  if (!process.argv.includes("--apply")) {
    console.log("Dry run: create helpdesk_ticket_counters, helpdesk_tickets, helpdesk_ticket_messages, helpdesk_attachments and helpdesk_ticket_events with their unique number/client_event_id/(subject, sequence) constraints (db/migrations/017_helpdesk_tickets.sql), then add the v2 flag columns and helpdesk_assist_log (db/migrations/018_helpdesk_v2.sql), the outcome delivery columns (019) and the v3 AI ratings table and alternatives column (020). Run with --apply to migrate the configured PostgreSQL database.");
    return;
  }
  loadEnvConfig(process.cwd());
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required.");
  try { await ensureSchema(); console.log("Helpdesk tickets schema is ready (017_helpdesk_tickets.sql to 020_helpdesk_ai_ratings.sql)."); }
  finally { await getPool().end(); }
}
main().catch(() => { console.error("Helpdesk tickets migration failed; check database configuration and migration permissions."); process.exitCode = 1; });

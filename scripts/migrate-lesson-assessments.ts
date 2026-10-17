import { loadEnvConfig } from "@next/env";
import { ensureSchema, getPool } from "../services/persistence/db";

// No data writes by default. --apply performs the additive schema bootstrap.
async function main() {
  if (!process.argv.includes("--apply")) {
    console.log("Dry run: create lesson_assessments and its user/course/lesson/kind primary key and unique last_event_id (db/migrations/015_lesson_assessments.sql). Run with --apply to migrate the configured PostgreSQL database.");
    return;
  }
  loadEnvConfig(process.cwd());
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required.");
  try { await ensureSchema(); console.log("Lesson assessments schema is ready (015_lesson_assessments.sql)."); }
  finally { await getPool().end(); }
}
main().catch(() => { console.error("Lesson assessments migration failed; check database configuration and migration permissions."); process.exitCode = 1; });

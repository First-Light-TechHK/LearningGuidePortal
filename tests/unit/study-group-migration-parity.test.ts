// Drift guard (design §4.5): db/migrations/012_study_group_persistence.sql and
// the inline ensureSchema copy in services/persistence/db.ts must declare the
// same Study Group tables, table bodies and indexes. A statement changed in
// one source without the other fails here before it can diverge in boot order.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATION_PATH = path.join(ROOT, "db", "migrations", "012_study_group_persistence.sql");
const BOOTSTRAP_PATH = path.join(ROOT, "services", "persistence", "db.ts");

const EXPECTED_TABLES = [
  "live_sessions",
  "study_group_attendance_intents",
  "study_group_meetings",
  "study_group_memberships",
  "study_group_outbox",
  "study_group_presences",
  "study_group_reminders",
  "study_group_token_log",
  "study_group_tutor_requests",
  "study_group_webhook_receipts",
  "study_groups"
];

function stripComments(sql: string) {
  return sql.replace(/--[^\n]*/g, " ");
}

function collapse(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function extractTables(source: string) {
  const tables = new Map<string, string>();
  for (const match of stripComments(source).matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\);/g)) {
    tables.set(match[1], collapse(match[2]));
  }
  return tables;
}

function extractIndexes(source: string) {
  const indexes = new Map<string, string>();
  for (const match of stripComments(source).matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\s+(\w+)\s+ON\s+[\s\S]*?;/g)) {
    const statement = collapse(match[0]);
    indexes.set(match[1], statement);
  }
  return indexes;
}

function isStudyGroupName(name: string) {
  return name.startsWith("study_group") || name === "live_sessions" || name.startsWith("live_sessions_");
}

test("012 and the ensureSchema bootstrap declare the same Study Group tables", () => {
  const migration = extractTables(readFileSync(MIGRATION_PATH, "utf8"));
  const bootstrap = extractTables(readFileSync(BOOTSTRAP_PATH, "utf8"));
  const migrationNames = [...migration.keys()].filter(isStudyGroupName).sort();
  const bootstrapNames = [...bootstrap.keys()].filter(isStudyGroupName).sort();
  assert.deepEqual(migrationNames, EXPECTED_TABLES, "012 must declare exactly the eleven Study Group tables");
  assert.deepEqual(bootstrapNames, EXPECTED_TABLES, "db.ts ensureSchema must declare exactly the eleven Study Group tables");
  for (const name of EXPECTED_TABLES) {
    assert.equal(bootstrap.get(name), migration.get(name), `table ${name} drifted between 012 and db.ts ensureSchema`);
  }
});

test("012 and the ensureSchema bootstrap declare the same Study Group indexes", () => {
  const migration = extractIndexes(readFileSync(MIGRATION_PATH, "utf8"));
  const bootstrap = extractIndexes(readFileSync(BOOTSTRAP_PATH, "utf8"));
  const migrationNames = [...migration.keys()].filter(isStudyGroupName).sort();
  const bootstrapNames = [...bootstrap.keys()].filter(isStudyGroupName).sort();
  assert.equal(migrationNames.length, 7, "012 must declare the seven Study Group indexes");
  assert.deepEqual(bootstrapNames, migrationNames, "db.ts ensureSchema must declare the same Study Group indexes as 012");
  for (const name of migrationNames) {
    assert.equal(bootstrap.get(name), migration.get(name), `index ${name} drifted between 012 and db.ts ensureSchema`);
  }
});

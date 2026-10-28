import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const TABLES = ["helpdesk_ticket_counters", "helpdesk_tickets", "helpdesk_ticket_messages", "helpdesk_attachments", "helpdesk_ticket_events"];
const normalise = (value: string) => value.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();

test("017 helpdesk migration is additive, repeatable and mirrored by the runtime bootstrap and probe", async () => {
  const migration = await readFile("db/migrations/017_helpdesk_tickets.sql", "utf8");
  const bootstrap = await readFile("services/persistence/db.ts", "utf8");
  assert.doesNotMatch(normalise(migration), /\b(DROP|TRUNCATE|DELETE|UPDATE|ALTER)\b/i, "the migration only adds");
  const statements = migration.match(/CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS[\s\S]*?;/g) || [];
  assert.ok(statements.length >= TABLES.length);
  for (const statement of statements) assert.ok(normalise(bootstrap).includes(normalise(statement)), `bootstrap mirrors: ${statement.split("\n")[0]}`);
  for (const table of TABLES) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`));
    assert.match(bootstrap, new RegExp(`to_regclass\\('${table}'\\) IS NOT NULL`));
  }
  assert.doesNotMatch(migration, /CREATE TABLE (?!IF NOT EXISTS)/);
  assert.doesNotMatch(migration, /CREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)/);
});

test("017 declares the idempotency, numbering, CloudEvents and optimistic-concurrency constraints", async () => {
  const migration = normalise(await readFile("db/migrations/017_helpdesk_tickets.sql", "utf8"));
  assert.match(migration, /number TEXT NOT NULL UNIQUE/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS helpdesk_tickets \([^;]*client_event_id UUID NOT NULL UNIQUE/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS helpdesk_ticket_messages \([^;]*client_event_id UUID UNIQUE/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS helpdesk_ticket_events \([^;]*client_event_id UUID UNIQUE/);
  assert.match(migration, /UNIQUE \(subject, sequence\)/);
  assert.match(migration, /specversion TEXT NOT NULL DEFAULT '1\.0'/);
  assert.match(migration, /rating SMALLINT CHECK \(rating BETWEEN 1 AND 5\)/);
  assert.match(migration, /char_length\(subject\) BETWEEN 1 AND 120/);
  assert.match(migration, /char_length\(body\) BETWEEN 1 AND 5000/);
  assert.match(migration, /size_bytes INTEGER NOT NULL CHECK \(size_bytes BETWEEN 1 AND 5242880\)/);
  assert.match(migration, /content_type TEXT NOT NULL CHECK \(content_type IN \('image\/png', 'image\/jpeg', 'image\/webp'\)\)/);
  assert.match(migration, /day TEXT PRIMARY KEY/);
});

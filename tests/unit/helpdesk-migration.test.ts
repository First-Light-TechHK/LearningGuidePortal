import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const TABLES = ["helpdesk_ticket_counters", "helpdesk_tickets", "helpdesk_ticket_messages", "helpdesk_attachments", "helpdesk_ticket_events", "helpdesk_ticket_tags"];
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
  assert.match(migration, /day TEXT PRIMARY KEY/);
});

test("017 carries the Figma addendum: enquiry types, contact email, suggestion, unread flag, wider attachments and tags", async () => {
  const migration = normalise(await readFile("db/migrations/017_helpdesk_tickets.sql", "utf8"));
  assert.match(migration, /category TEXT NOT NULL CHECK \(category IN \('technical_support', 'course_content', 'payments_subscriptions', 'other'\)\)/);
  assert.match(migration, /contact_email TEXT NOT NULL CHECK \(char_length\(contact_email\) BETWEEN 3 AND 254\)/);
  assert.match(migration, /suggestion_id UUID,/);
  assert.match(migration, /unread_by_agent BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /attachment_ids UUID\[\] NOT NULL DEFAULT '\{\}' CHECK \(cardinality\(attachment_ids\) <= 5\)/);
  assert.match(migration, /size_bytes INTEGER NOT NULL CHECK \(size_bytes BETWEEN 1 AND 10485760\)/);
  assert.match(migration, /content_type TEXT NOT NULL CHECK \(content_type IN \('image\/png', 'image\/jpeg', 'image\/webp', 'image\/gif', 'application\/pdf', 'text\/plain', 'text\/csv', 'application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document', 'application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet'\)\)/);
  assert.doesNotMatch(migration, /svg|html/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS helpdesk_ticket_tags \( ticket_id UUID NOT NULL REFERENCES helpdesk_tickets\(id\), tag TEXT NOT NULL CHECK \(char_length\(tag\) BETWEEN 1 AND 32\), created_at TIMESTAMPTZ NOT NULL, PRIMARY KEY \(ticket_id, tag\) \);/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS helpdesk_ticket_tags_tag_idx ON helpdesk_ticket_tags \(tag\);/);
});

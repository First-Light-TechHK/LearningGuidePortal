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

test("018 (v2) is a new additive, repeatable migration mirrored by the bootstrap; 017 is untouched", async () => {
  const migration = await readFile("db/migrations/018_helpdesk_v2.sql", "utf8");
  const bootstrap = await readFile("services/persistence/db.ts", "utf8");
  const plain = normalise(migration);
  assert.doesNotMatch(plain, /\b(DROP|TRUNCATE|DELETE|UPDATE)\b/i, "the migration only adds");
  const statements = migration.replace(/--[^\n]*/g, "").match(/(?:CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS|ALTER TABLE)[\s\S]*?;/g) || [];
  assert.ok(statements.length >= 6);
  for (const statement of statements) assert.ok(normalise(bootstrap).includes(normalise(statement)), `bootstrap mirrors: ${statement.split("\n")[0]}`);
  for (const statement of plain.match(/ALTER TABLE [^;]*;/g) || []) assert.match(statement, /^ALTER TABLE helpdesk_tickets ADD COLUMN IF NOT EXISTS /, "ALTER only adds nullable columns");
  assert.match(plain, /ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMPTZ;/);
  assert.match(plain, /ADD COLUMN IF NOT EXISTS flagged_by TEXT;/);
  assert.match(plain, /CREATE TABLE IF NOT EXISTS helpdesk_assist_log \([^;]*source TEXT NOT NULL CHECK \(source IN \('submit', 'chat', 'chip'\)\)/);
  assert.match(plain, /feedback TEXT CHECK \(feedback IN \('helpful', 'not_helpful', 'solved', 'declined', 'edited'\)\)/);
  assert.match(plain, /question TEXT NOT NULL CHECK \(char_length\(question\) BETWEEN 1 AND 500\)/);
  assert.match(plain, /ticket_id UUID REFERENCES helpdesk_tickets\(id\)/);
  assert.match(plain, /client_event_id UUID UNIQUE/);
  assert.match(bootstrap, /to_regclass\('helpdesk_assist_log'\) IS NOT NULL/);
  assert.match(bootstrap, /table_name = 'helpdesk_tickets'\s+AND column_name = 'flagged_at'/, "the probe covers the newest column");
  assert.doesNotMatch(plain, /CREATE TABLE (?!IF NOT EXISTS)/);
  assert.doesNotMatch(plain, /CREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)/);
});

test("019 records when Admin confirmed an assist outcome; additive, repeatable, mirrored by the bootstrap; 017 and 018 untouched", async () => {
  const migration = await readFile("db/migrations/019_helpdesk_outcome_delivery.sql", "utf8");
  const bootstrap = await readFile("services/persistence/db.ts", "utf8");
  const plain = normalise(migration);
  assert.doesNotMatch(plain, /\b(DROP|TRUNCATE|DELETE|UPDATE)\b/i, "the migration only adds");
  const statements = migration.replace(/--[^\n]*/g, "").match(/(?:CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS|ALTER TABLE)[\s\S]*?;/g) || [];
  assert.equal(statements.length, 3);
  for (const statement of statements) assert.ok(normalise(bootstrap).includes(normalise(statement)), `bootstrap mirrors: ${statement.split("\n")[0]}`);
  assert.match(plain, /ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS feedback_delivered_at TIMESTAMPTZ;/);
  assert.match(plain, /ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS feedback_attempted_at TIMESTAMPTZ;/);
  assert.match(plain, /CREATE INDEX IF NOT EXISTS helpdesk_assist_log_undelivered_idx ON helpdesk_assist_log \(feedback_attempted_at NULLS FIRST, created_at, id\) WHERE feedback IS NOT NULL AND feedback_delivered_at IS NULL;/);
  assert.match(bootstrap, /table_name = 'helpdesk_assist_log'\s+AND column_name = 'feedback_attempted_at'/, "the probe covers the newest column");
});

test("020 (v3) adds the AI answer ratings and the offered alternatives; additive, repeatable, mirrored by the bootstrap and probe; 017–019 untouched", async () => {
  const migration = await readFile("db/migrations/020_helpdesk_ai_ratings.sql", "utf8");
  const bootstrap = await readFile("services/persistence/db.ts", "utf8");
  const plain = normalise(migration);
  assert.doesNotMatch(plain, /\b(DROP|TRUNCATE|DELETE|UPDATE)\b/i, "the migration only adds");
  const statements = migration.replace(/--[^\n]*/g, "").match(/(?:CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS|ALTER TABLE)[\s\S]*?;/g) || [];
  assert.equal(statements.length, 2);
  for (const statement of statements) assert.ok(normalise(bootstrap).includes(normalise(statement)), `bootstrap mirrors: ${statement.split("\n")[0]}`);
  // One rating per answer: the run id (the assist log row the learner was shown) is the key, so the first rating wins.
  assert.match(plain, /CREATE TABLE IF NOT EXISTS helpdesk_ai_ratings \( run_id UUID PRIMARY KEY REFERENCES helpdesk_assist_log\(id\), learner_id TEXT NOT NULL, source TEXT NOT NULL CHECK \(source IN \('submit', 'chat', 'chip'\)\), rating SMALLINT NOT NULL CHECK \(rating BETWEEN 1 AND 5\), created_at TIMESTAMPTZ NOT NULL \);/);
  assert.match(plain, /ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS alternatives JSONB;/, "a nullable column: existing rows read as no alternatives");
  assert.match(bootstrap, /to_regclass\('helpdesk_ai_ratings'\) IS NOT NULL/);
  assert.match(bootstrap, /table_name = 'helpdesk_assist_log'\s+AND column_name = 'alternatives'/, "the probe covers the newest column");
  for (const earlier of ["017_helpdesk_tickets.sql", "018_helpdesk_v2.sql", "019_helpdesk_outcome_delivery.sql"]) assert.doesNotMatch(await readFile(`db/migrations/${earlier}`, "utf8"), /helpdesk_ai_ratings|alternatives/);
});

test("022 (v4) adds the enquiry's order number; additive, repeatable, mirrored by the bootstrap and probe; 017–020 untouched", async () => {
  const migration = await readFile("db/migrations/022_helpdesk_order_link.sql", "utf8");
  const bootstrap = await readFile("services/persistence/db.ts", "utf8");
  const plain = normalise(migration);
  assert.doesNotMatch(plain, /\b(DROP|TRUNCATE|DELETE|UPDATE)\b/i, "the migration only adds");
  const statements = migration.replace(/--[^\n]*/g, "").match(/(?:CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS|ALTER TABLE)[\s\S]*?;/g) || [];
  assert.equal(statements.length, 1);
  for (const statement of statements) assert.ok(normalise(bootstrap).includes(normalise(statement)), `bootstrap mirrors: ${statement.split("\n")[0]}`);
  // Nullable (every existing ticket has no order), no foreign key: the order record stays the payment module's.
  assert.match(plain, /^ALTER TABLE helpdesk_tickets ADD COLUMN IF NOT EXISTS order_id TEXT CHECK \(order_id IS NULL OR char_length\(order_id\) BETWEEN 1 AND 64\);$/);
  assert.doesNotMatch(plain, /NOT NULL|REFERENCES/);
  assert.match(bootstrap, /table_name = 'helpdesk_tickets'\s+AND column_name = 'order_id'/, "the probe covers the newest column");
  for (const earlier of ["017_helpdesk_tickets.sql", "018_helpdesk_v2.sql", "019_helpdesk_outcome_delivery.sql", "020_helpdesk_ai_ratings.sql"]) assert.doesNotMatch(await readFile(`db/migrations/${earlier}`, "utf8"), /order_id/);
});

test("023 (v5) adds the chat sessions and the assist log's turn columns; additive, repeatable, mirrored by the bootstrap and probe; 017–022 untouched", async () => {
  const migration = await readFile("db/migrations/023_helpdesk_chat_sessions.sql", "utf8");
  const bootstrap = await readFile("services/persistence/db.ts", "utf8");
  const plain = normalise(migration);
  assert.doesNotMatch(plain, /\b(DROP|TRUNCATE|DELETE|UPDATE)\b/i, "the migration only adds");
  const statements = migration.replace(/--[^\n]*/g, "").match(/(?:CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS|ALTER TABLE)[\s\S]*?;/g) || [];
  assert.equal(statements.length, 18);
  for (const statement of statements) assert.ok(normalise(bootstrap).includes(normalise(statement)), `bootstrap mirrors: ${statement.split("\n")[0]}`);
  assert.match(plain, /CREATE TABLE IF NOT EXISTS helpdesk_chat_sessions \( id UUID PRIMARY KEY, learner_id TEXT NOT NULL, locale TEXT NOT NULL CHECK \(locale IN \('en-GB', 'zh-CN'\)\),/);
  assert.match(plain, /end_reason TEXT CHECK \(end_reason IN \('idle', 'ended_by_learner', 'handover', 'ticket'\)\)/);
  assert.match(plain, /turns SMALLINT NOT NULL DEFAULT 0 CHECK \(turns >= 0\), unsolved_streak SMALLINT NOT NULL DEFAULT 0 CHECK \(unsolved_streak >= 0\), current_node_id UUID,/);
  assert.match(plain, /CHECK \(\(ended_at IS NULL\) = \(end_reason IS NULL\)\)/);
  // Every assist log column is nullable (rows before v5 and submit checks read as "no session"), and every enum is the contract's.
  const columns = (plain.match(/ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS (\w+)/g) || []).map((line) => line.split(" ").pop());
  assert.deepEqual(columns, ["session_id", "turn_index", "node_id", "parent_node_id", "via", "kind", "intent", "guard", "release_version", "trace_id", "signals", "blocks", "expanded", "covered", "texts"]);
  for (const statement of plain.match(/ALTER TABLE [^;]*;/g) || []) {
    assert.match(statement, /^ALTER TABLE helpdesk_assist_log ADD COLUMN IF NOT EXISTS /);
    assert.doesNotMatch(statement, /NOT NULL|DEFAULT/, `nullable, no default: ${statement}`);
  }
  const { ASSIST_VIAS, GUARD_REASONS, SITUATION_SIGNALS, SUGGEST_INTENTS, SUGGEST_KINDS, CHAT_END_REASONS } = await import("../../contracts/helpdesk");
  const list = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");
  assert.ok(plain.includes(`via TEXT CHECK (via IN (${list(ASSIST_VIAS)}))`));
  assert.ok(plain.includes(`kind TEXT CHECK (kind IN (${list([...SUGGEST_KINDS, "handover"])}))`));
  assert.ok(plain.includes(`intent TEXT CHECK (intent IN (${list(SUGGEST_INTENTS)}))`));
  assert.ok(plain.includes(`guard TEXT CHECK (guard IN (${list(["passed", "fallback", ...GUARD_REASONS])}))`));
  assert.ok(plain.includes(`end_reason TEXT CHECK (end_reason IN (${list(CHAT_END_REASONS)}))`));
  assert.equal(plain.split(`signals <@ ARRAY[${list(SITUATION_SIGNALS)}]::text[]`).length - 1, 2, "both signal columns allow the Part A enum only");
  assert.match(plain, /session_id UUID REFERENCES helpdesk_chat_sessions\(id\)/);
  assert.match(plain, /CREATE UNIQUE INDEX IF NOT EXISTS helpdesk_assist_log_session_turn_idx ON helpdesk_assist_log \(session_id, turn_index\) WHERE session_id IS NOT NULL;/);
  assert.match(bootstrap, /to_regclass\('helpdesk_chat_sessions'\) IS NOT NULL/);
  assert.match(bootstrap, /table_name = 'helpdesk_assist_log'\s+AND column_name = 'texts'/, "the probe covers the newest column");
  for (const earlier of ["017_helpdesk_tickets.sql", "018_helpdesk_v2.sql", "019_helpdesk_outcome_delivery.sql", "020_helpdesk_ai_ratings.sql", "022_helpdesk_order_link.sql"]) assert.doesNotMatch(await readFile(`db/migrations/${earlier}`, "utf8"), /helpdesk_chat_sessions|session_id|turn_index/);
});

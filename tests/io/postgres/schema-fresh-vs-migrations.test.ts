// Fresh-database proofs (persistence review 2026-11-03, after upstream's
// overlay-check caught the 027 outbox index placed above its table): the
// ensureSchema bootstrap and the db/migrations chain are two sources of one
// schema, and each must work on an EMPTY database, on a database the other
// built, and on a database that stopped before 026/027. Every proof runs in a
// worker process against its own empty schema (DATABASE_URL + search_path), so
// ensureSchema's per-process memo and getPool's singleton cannot leak state
// between proofs, and nothing here touches the caller's public schema.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { getPool } from "../../../services/persistence/db";
import { STUDY_GROUP_TABLES, closePool, requireDatabaseUrl, runWorkers, workerResult } from "./harness";
import type { Catalog } from "./reviewWorkers";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER_FILE = path.join(HERE, "reviewWorkers.ts");
const MIGRATIONS = readdirSync(path.resolve(HERE, "../../../db/migrations")).filter((name) => /^\d{3}_.*\.sql$/.test(name)).sort();
const OBJECTS_026_027 = {
  tables: ["helpdesk_rate_hits"],
  indexes: ["helpdesk_rate_hits_key_idx", "study_group_outbox_session_idx", "study_group_presences_open_user_idx"]
};
// Declared by migrations 009 and 011 but never mirrored into the bootstrap
// (predates 026/027; reported by the review, not introduced by it). Listed
// here so the parity assertion below stays exact: a new drift fails.
const KNOWN_MIGRATION_ONLY_TABLES = ["product_payment_keys", "wechat_login_tickets"];
// Declared by the bootstrap only: no db/migrations file creates app_files, so a
// database built by the migration chain alone fails SCHEMA_PROBE
// (to_regclass('app_files')) and every first boot takes the DDL path once.
// Reported by the review; the probe expectation below flips to "ready" the
// moment a migration mirrors it and this list is emptied.
const KNOWN_BOOTSTRAP_ONLY_TABLES: string[] = []; // app_files gained 028_app_files.sql
const KNOWN_GAP_TABLES = [...KNOWN_MIGRATION_ONLY_TABLES, ...KNOWN_BOOTSTRAP_ONLY_TABLES];
const CHAIN_ALONE_IS_CURRENT = KNOWN_BOOTSTRAP_ONLY_TABLES.length === 0;

type BootstrapResult = { readyBefore: boolean; readyAfter: boolean; catalog: Catalog };
type MigrateResult = { applied: string[]; readyAfterMigrations: boolean; readyAfterBootstrap?: boolean; migratedCatalog?: Catalog; catalog: Catalog };

const schemas: string[] = [];

function urlWithSchema(schema: string) {
  const base = requireDatabaseUrl();
  return `${base}${base.includes("?") ? "&" : "?"}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
}

async function emptySchema(): Promise<string> {
  const schema = `reva_io_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  await getPool().query(`CREATE SCHEMA ${schema}`);
  schemas.push(schema);
  return urlWithSchema(schema);
}

async function spawn<T>(specs: Array<{ mode: string; env: Record<string, string> }>): Promise<T[]> {
  const outcomes = await runWorkers(specs, { workerFile: WORKER_FILE, timeoutMs: 120_000, readyTimeoutMs: 60_000 });
  return outcomes.map((outcome) => workerResult<T>(outcome));
}

/** Human-readable differences between two catalogs (empty when they declare the same schema). */
function diffCatalog(left: Catalog, right: Catalog, names: [string, string]): string[] {
  const out: string[] = [];
  const keys = (a: object, b: object) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const table of keys(left.tables, right.tables)) {
    const l = left.tables[table];
    const r = right.tables[table];
    if (!l) { out.push(`table ${table}: only in ${names[1]}`); continue; }
    if (!r) { out.push(`table ${table}: only in ${names[0]}`); continue; }
    for (const column of keys(l, r)) {
      if (!l[column]) out.push(`column ${table}.${column}: only in ${names[1]}`);
      else if (!r[column]) out.push(`column ${table}.${column}: only in ${names[0]}`);
      else if (JSON.stringify(l[column]) !== JSON.stringify(r[column])) out.push(`column ${table}.${column}: ${JSON.stringify(l[column])} (${names[0]}) vs ${JSON.stringify(r[column])} (${names[1]})`);
    }
  }
  const groups: Array<[string, Record<string, string>, Record<string, string>]> = [
    ["index", left.indexes, right.indexes],
    ["constraint", left.constraints, right.constraints],
    ["view", left.views, right.views]
  ];
  for (const [kind, l, r] of groups) {
    for (const name of keys(l, r)) {
      if (!(name in l)) out.push(`${kind} ${name}: only in ${names[1]}`);
      else if (!(name in r)) out.push(`${kind} ${name}: only in ${names[0]}`);
      else if (l[name] !== r[name]) out.push(`${kind} ${name}: ${l[name]} (${names[0]}) vs ${r[name]} (${names[1]})`);
    }
  }
  for (const sequence of [...new Set([...left.sequences, ...right.sequences])].sort()) {
    if (!left.sequences.includes(sequence)) out.push(`sequence ${sequence}: only in ${names[1]}`);
    else if (!right.sequences.includes(sequence)) out.push(`sequence ${sequence}: only in ${names[0]}`);
  }
  return out;
}

const belongsToKnownGap = (line: string) => KNOWN_GAP_TABLES.some((table) => line.includes(` ${table}`) || line.includes(`${table}.`) || line.includes(`${table}_`));

let bootstrapOnEmpty: BootstrapResult;
let chainThenBootstrap: MigrateResult;

before(async () => {
  requireDatabaseUrl();
  // (a) the bootstrap on an empty schema and (b) the whole migration chain on
  // another empty schema, then the bootstrap on top: one spawn, two workers.
  const [a, b] = await Promise.all([emptySchema(), emptySchema()]);
  const results = await spawn<BootstrapResult | MigrateResult>([
    { mode: "bootstrap", env: { DATABASE_URL: a } },
    { mode: "migrate", env: { DATABASE_URL: b, LG_IO_THEN_BOOTSTRAP: "1" } }
  ]);
  bootstrapOnEmpty = results[0] as BootstrapResult;
  chainThenBootstrap = results[1] as MigrateResult;
});

after(async () => {
  for (const schema of schemas) await getPool().query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await closePool();
});

test("(a) ensureSchema on an EMPTY database succeeds in one pass and the freshness probe is ready afterwards", () => {
  assert.equal(bootstrapOnEmpty.readyBefore, false, "an empty schema is not current");
  assert.equal(bootstrapOnEmpty.readyAfter, true, "SCHEMA_PROBE must be ready right after the batch");
  const tables = Object.keys(bootstrapOnEmpty.catalog.tables);
  for (const table of [...STUDY_GROUP_TABLES, ...OBJECTS_026_027.tables]) assert.ok(tables.includes(table), `bootstrap creates ${table}`);
  for (const index of OBJECTS_026_027.indexes) assert.ok(index in bootstrapOnEmpty.catalog.indexes, `bootstrap creates ${index}`);
  assert.equal(bootstrapOnEmpty.catalog.indexes.study_group_outbox_session_idx, "CREATE INDEX study_group_outbox_session_idx ON study_group_outbox USING btree (session_id)");
  assert.equal(bootstrapOnEmpty.catalog.indexes.study_group_presences_open_user_idx, "CREATE INDEX study_group_presences_open_user_idx ON study_group_presences USING btree (user_id) WHERE (left_at IS NULL)");
});

test("(b) every db/migrations file applies in numeric order on an EMPTY database; the chain alone is current only once app_files has a migration (known gap); one bootstrap on top is enough; beyond the known gaps the two sources declare the same objects", () => {
  assert.deepEqual(chainThenBootstrap.applied, MIGRATIONS, "every migration file applied, in order");
  assert.ok(chainThenBootstrap.applied.at(-1)?.startsWith("028_"), "028_app_files.sql is the last file of the chain");
  assert.equal(chainThenBootstrap.readyAfterMigrations, CHAIN_ALONE_IS_CURRENT, CHAIN_ALONE_IS_CURRENT
    ? "after the whole chain, SCHEMA_PROBE is ready: ensureSchema runs no DDL"
    : `the chain alone cannot satisfy SCHEMA_PROBE while ${KNOWN_BOOTSTRAP_ONLY_TABLES.join(", ")} has no migration (known gap)`);
  assert.equal(chainThenBootstrap.readyAfterBootstrap, true, "one bootstrap on top of the chain makes the probe ready");
  const migrated = chainThenBootstrap.migratedCatalog as Catalog;
  const addedByBootstrap = diffCatalog(migrated, chainThenBootstrap.catalog, ["migrations", "migrations+bootstrap"]);
  assert.deepEqual(addedByBootstrap.filter((line) => !belongsToKnownGap(line)), [], "on top of the chain the bootstrap adds nothing beyond the known gap");
  for (const table of KNOWN_BOOTSTRAP_ONLY_TABLES) {
    assert.ok(!(table in migrated.tables), `${table} is still missing from the chain (empty KNOWN_BOOTSTRAP_ONLY_TABLES once a migration creates it)`);
    assert.ok(table in chainThenBootstrap.catalog.tables, `${table} is created by the bootstrap`);
  }
  const drift = diffCatalog(migrated, bootstrapOnEmpty.catalog, ["migrations", "bootstrap"]);
  const unexpected = drift.filter((line) => !belongsToKnownGap(line));
  assert.deepEqual(unexpected, [], "objects declared by one source and not the other (beyond the known gaps)");
  const known = drift.filter(belongsToKnownGap);
  for (const table of KNOWN_MIGRATION_ONLY_TABLES) assert.ok(known.includes(`table ${table}: only in migrations`), `${table} is still the known migration-only table (update KNOWN_MIGRATION_ONLY_TABLES when the bootstrap mirrors it)`);
});

test("(c) the migration chain, 026 and 027 included, applied twice on an EMPTY database is idempotent and ends with the same schema", async () => {
  const [result] = await spawn<MigrateResult>([{ mode: "migrate", env: { DATABASE_URL: await emptySchema(), LG_IO_MIGRATE_TIMES: "2" } }]);
  assert.deepEqual(result.applied, MIGRATIONS);
  assert.equal(result.readyAfterMigrations, CHAIN_ALONE_IS_CURRENT);
  assert.deepEqual(diffCatalog(result.catalog, chainThenBootstrap.migratedCatalog as Catalog, ["twice", "once"]), []);
});

test("(d) a database that stopped at migration 025 is not current; ensureSchema adds exactly the 026/027 objects and nothing else", async () => {
  const [result] = await spawn<MigrateResult>([{ mode: "migrate", env: { DATABASE_URL: await emptySchema(), LG_IO_MIGRATE_UPTO: "25", LG_IO_THEN_BOOTSTRAP: "1" } }]);
  assert.deepEqual(result.applied, MIGRATIONS.filter((name) => Number(name.slice(0, 3)) <= 25));
  assert.equal(result.readyAfterMigrations, false, "the probe must notice the missing 026/027 objects");
  const before = result.migratedCatalog as Catalog;
  for (const table of OBJECTS_026_027.tables) assert.ok(!(table in before.tables), `${table} absent before`);
  for (const index of OBJECTS_026_027.indexes) assert.ok(!(index in before.indexes), `${index} absent before`);
  assert.equal(result.readyAfterBootstrap, true);
  for (const table of OBJECTS_026_027.tables) assert.ok(table in result.catalog.tables, `${table} added by the bootstrap`);
  for (const index of OBJECTS_026_027.indexes) assert.ok(index in result.catalog.indexes, `${index} added by the bootstrap`);
  // ... and the result is the schema the full chain builds (009/011 are in both here; app_files is the known bootstrap-only table).
  const drift = diffCatalog(result.catalog, chainThenBootstrap.migratedCatalog as Catalog, ["025+bootstrap", "full chain"]);
  assert.deepEqual(drift.filter((line) => !KNOWN_BOOTSTRAP_ONLY_TABLES.some((table) => line.includes(` ${table}`) || line.includes(`${table}.`) || line.includes(`${table}_`))), []);
});

// Worker process entry for the persistence review proofs (2026-11-03):
//  - "bootstrap": ensureSchema() on whatever DATABASE_URL names (the parent
//    points it at an EMPTY schema), then report the freshness probe and the
//    catalog.
//  - "migrate": apply db/migrations/*.sql in numeric order (up to
//    LG_IO_MIGRATE_UPTO, LG_IO_MIGRATE_TIMES times each), optionally run
//    ensureSchema() afterwards (LG_IO_THEN_BOOTSTRAP=1), and report the probe
//    before/after plus the catalogs.
//  - "rate-hit": LG_IO_RATE_ATTEMPTS concurrent tryRateHit() calls on one key
//    from this process's own pool (two of these behind the barrier are two
//    Portal instances hammering one learner's limit).
// A fresh process per run, so ensureSchema's per-process memo and getPool's
// singleton bind to the worker's DATABASE_URL alone. The result is printed as
// one LG_IO_RESULT line, like workers.ts.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureSchema, getPool, schemaIsCurrent } from "../../../services/persistence/db";
import { createPostgresHelpdeskRepository } from "../../../repositories/helpdeskRepository";

const MODE = process.env.LG_IO_MODE || "";
const ROLE = process.env.LG_IO_ROLE || "A";
const BARRIER_DIR = process.env.LG_IO_BARRIER_DIR || "";
const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../db/migrations");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForGo() {
  mkdirSync(BARRIER_DIR, { recursive: true });
  writeFileSync(path.join(BARRIER_DIR, `${ROLE}.ready`), `${process.pid}\n`);
  const started = Date.now();
  while (!existsSync(path.join(BARRIER_DIR, "go"))) {
    if (Date.now() - started > 20_000) throw new Error("barrier timeout");
    await sleep(5);
  }
}

export type CatalogColumn = { type: string; nullable: string; default: string | null };
export type Catalog = {
  schema: string;
  tables: Record<string, Record<string, CatalogColumn>>;
  indexes: Record<string, string>;
  constraints: Record<string, string>;
  views: Record<string, string>;
  sequences: string[];
};

/** Every object of the current schema, with the schema name stripped so two schemas compare. */
async function snapshotCatalog(): Promise<Catalog> {
  const pool = getPool();
  const schema = (await pool.query<{ schema: string }>("SELECT current_schema() AS schema")).rows[0].schema;
  const strip = (text: string | null) => (text === null ? null : text.replaceAll(`${schema}.`, "").replace(/\s+/g, " ").trim());
  const columns = await pool.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
    `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
     WHERE table_schema = $1 ORDER BY table_name, column_name`, [schema]);
  const tables: Catalog["tables"] = {};
  for (const row of columns.rows) {
    (tables[row.table_name] ??= {})[row.column_name] = { type: row.data_type, nullable: row.is_nullable, default: strip(row.column_default) };
  }
  // Views are listed by information_schema.columns too; keep them apart.
  const views = await pool.query<{ viewname: string; definition: string }>("SELECT viewname, definition FROM pg_views WHERE schemaname = $1 ORDER BY viewname", [schema]);
  for (const row of views.rows) delete tables[row.viewname];
  const indexes = await pool.query<{ indexname: string; indexdef: string }>("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname", [schema]);
  const constraints = await pool.query<{ table: string; conname: string; definition: string }>(
    `SELECT c.conrelid::regclass::text AS "table", c.conname, pg_get_constraintdef(c.oid) AS definition
     FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = $1 ORDER BY 1, 2`, [schema]);
  const sequences = await pool.query<{ sequence_name: string }>("SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = $1 ORDER BY 1", [schema]);
  return {
    schema,
    tables,
    indexes: Object.fromEntries(indexes.rows.map((row) => [row.indexname, strip(row.indexdef) as string])),
    constraints: Object.fromEntries(constraints.rows.map((row) => [`${strip(row.table)}.${row.conname}`, strip(row.definition) as string])),
    views: Object.fromEntries(views.rows.map((row) => [row.viewname, strip(row.definition) as string])),
    sequences: sequences.rows.map((row) => row.sequence_name)
  };
}

export function migrationFiles(upTo = Number.POSITIVE_INFINITY): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{3}_.*\.sql$/.test(name))
    .sort((a, b) => Number(a.slice(0, 3)) - Number(b.slice(0, 3)))
    .filter((name) => Number(name.slice(0, 3)) <= upTo);
}

async function applyMigrations(upTo: number, times: number): Promise<string[]> {
  const applied: string[] = [];
  for (const name of migrationFiles(upTo)) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
    for (let round = 0; round < times; round += 1) {
      try {
        await getPool().query(sql);
      } catch (error) {
        throw new Error(`migration ${name} (round ${round + 1}) failed: ${(error as Error).message}`);
      }
    }
    applied.push(name);
  }
  return applied;
}

async function run(): Promise<Record<string, unknown>> {
  await waitForGo();
  switch (MODE) {
    case "bootstrap": {
      const readyBefore = await schemaIsCurrent();
      await ensureSchema();
      return { role: ROLE, readyBefore, readyAfter: await schemaIsCurrent(), catalog: await snapshotCatalog() };
    }
    case "migrate": {
      const upTo = Number(process.env.LG_IO_MIGRATE_UPTO || "999");
      const times = Number(process.env.LG_IO_MIGRATE_TIMES || "1");
      const applied = await applyMigrations(upTo, times);
      const migrated = await snapshotCatalog();
      const readyAfterMigrations = await schemaIsCurrent();
      if (process.env.LG_IO_THEN_BOOTSTRAP !== "1") return { role: ROLE, applied, readyAfterMigrations, catalog: migrated };
      await ensureSchema();
      return { role: ROLE, applied, readyAfterMigrations, readyAfterBootstrap: await schemaIsCurrent(), migratedCatalog: migrated, catalog: await snapshotCatalog() };
    }
    case "rate-hit": {
      const repository = createPostgresHelpdeskRepository();
      const key = process.env.LG_IO_RATE_KEY || "assist:worker";
      const limit = Number(process.env.LG_IO_RATE_LIMIT || "30");
      const attempts = Number(process.env.LG_IO_RATE_ATTEMPTS || "20");
      const at = process.env.LG_IO_RATE_AT || new Date().toISOString();
      const outcomes = await Promise.all(Array.from({ length: attempts }, () => repository.tryRateHit(key, limit, 3_600_000, at)));
      return { role: ROLE, allowed: outcomes.filter((item) => item.allowed).length, refused: outcomes.filter((item) => !item.allowed).length };
    }
    default:
      throw new Error(`unknown LG_IO_MODE ${MODE}`);
  }
}

// Only a spawned worker (barrier set) runs; a test importing the types above does not.
if (BARRIER_DIR) run()
  .then(async (result) => {
    console.log(`LG_IO_RESULT ${JSON.stringify(result)}`);
    await getPool().end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    try {
      await getPool().end();
    } catch {
      // no pool was opened
    }
    process.exit(1);
  });

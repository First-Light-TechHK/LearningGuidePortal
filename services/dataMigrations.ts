import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { dataMigrations, type DataChange } from "../db/data-migrations";
import { DATA_MIGRATION_ID, type DataMigration, type DataMigrationContext, type DataMigrationDomain } from "../db/data-migrations/types";
import { PROTECTED_TABLES, createMemoryOrm, ormFromProductData, type MigrationOrm } from "./migrationOrm";
import type { ProductData } from "./productStore";

export type DataMigrationReport = {
  applied: string[];
  skipped: string[];
  changes: Array<DataChange & { migration: string }>;
};

const TABLE_DOMAIN: Record<(typeof PROTECTED_TABLES)[number], DataMigrationDomain> = {
  users: "users",
  sessions: "sessions",
  accounts: "accounts",
  orders: "orders",
  quotes: "quotes",
  subscriptions: "subscriptions",
  entitlements: "entitlements",
  studyRecords: "studyRecords",
  studyEvents: "studyEvents",
  conversations: "conversations",
  notifications: "notifications",
  verificationTokens: "tokens",
  passwordResetTokens: "tokens",
  emailBindingTokens: "tokens",
  stripeEvents: "orders",
};

function recordedIds(data: ProductData | undefined, orm: MigrationOrm) {
  const fromProduct = [...((data?.dataMigrations || [])), ...((data?.catalogueMigrations || []))];
  const fromOrm = orm.table<{ id: string }>("_data_migrations").all().map((row) => row.id);
  return new Set([...fromProduct, ...fromOrm]);
}

function assertTouches(orm: MigrationOrm, before: Record<string, string>, touches: readonly string[], migrationId: string) {
  const allowed = new Set(touches);
  for (const table of PROTECTED_TABLES) {
    const domain = TABLE_DOMAIN[table];
    if (allowed.has(domain) || allowed.has(table)) continue;
    if (before[table] !== orm.snapshot(table)) {
      throw new Error(`Migration ${migrationId} changed ${table} without declaring touches: ["${domain}"].`);
    }
  }
  if (orm.extraTables().some((name) => before[name] !== orm.snapshot(name)) && !allowed.has("other")) {
    throw new Error(`Migration ${migrationId} changed a non-product table without declaring touches: ["other"].`);
  }
  if (orm.files.changed() && !allowed.has("files") && !allowed.has("media")) {
    throw new Error(`Migration ${migrationId} wrote files without declaring touches: ["files"].`);
  }
}

export function validateDataMigrations(migrations: DataMigration[]) {
  const seen = new Set<string>();
  for (const migration of migrations) {
    if (!DATA_MIGRATION_ID.test(migration.id)) throw new Error(`Invalid data migration id "${migration.id}". Use NNN_snake_case.`);
    if (seen.has(migration.id)) throw new Error(`Duplicate data migration id "${migration.id}".`);
    seen.add(migration.id);
    if (!migration.description?.trim()) throw new Error(`Migration ${migration.id} needs a description.`);
    if (!Array.isArray(migration.touches) || migration.touches.length === 0) throw new Error(`Migration ${migration.id} must declare touches.`);
  }
}

export function registeredMigrationFilenames() {
  const directory = path.join(process.cwd(), "db/data-migrations");
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => /^\d{3}_[a-z0-9_]+\.ts$/.test(name)).sort();
}

export function assertMigrationRegistry(migrations = dataMigrations) {
  validateDataMigrations(migrations);
  const files = registeredMigrationFilenames();
  if (!files.length) return;
  const expected = migrations.map((migration) => `${migration.id}.ts`);
  const missing = files.filter((name) => !expected.includes(name));
  const extra = expected.filter((name) => !files.includes(name));
  if (missing.length || extra.length) {
    throw new Error(`dataMigrations in db/data-migrations/index.ts does not match numbered files. Add files: ${missing.join(", ") || "none"}. Register: ${extra.join(", ") || "none"}.`);
  }
}

function defaultContext(overrides: Partial<DataMigrationContext> = {}): DataMigrationContext {
  return { store: "memory", dryRun: false, now: new Date().toISOString(), ...overrides };
}

function record(data: ProductData | undefined, orm: MigrationOrm, id: string) {
  orm.table<{ id: string }>("_data_migrations").upsert({ id });
  if (!data) return;
  data.dataMigrations ||= [];
  data.catalogueMigrations ||= [];
  if (!data.dataMigrations.includes(id)) data.dataMigrations.push(id);
  if (!data.catalogueMigrations.includes(id)) data.catalogueMigrations.push(id);
}

export async function applyOrmMigrations(
  orm: MigrationOrm,
  migrations: DataMigration[] = dataMigrations,
  ctx: Partial<DataMigrationContext> = {},
  data?: ProductData,
): Promise<DataMigrationReport> {
  validateDataMigrations(migrations);
  if (migrations === dataMigrations) assertMigrationRegistry(migrations);
  const seen = recordedIds(data, orm);
  const context = defaultContext(ctx);
  const report: DataMigrationReport = { applied: [], skipped: [], changes: [] };
  for (const migration of migrations) {
    if (seen.has(migration.id)) {
      report.skipped.push(migration.id);
      continue;
    }
    const before = Object.fromEntries(
      [...PROTECTED_TABLES, ...orm.extraTables()].map((name) => [name, orm.snapshot(name)]),
    );
    const changes = await migration.apply(orm, context);
    assertTouches(orm, before, migration.touches, migration.id);
    report.changes.push(...changes.map((change) => ({ ...change, migration: migration.id })));
    record(data, orm, migration.id);
    seen.add(migration.id);
    if (changes.some((change) => change.action === "add" || change.action === "update")) report.applied.push(migration.id);
    else report.skipped.push(migration.id);
  }
  return report;
}

export async function applyDataMigrations(
  data: ProductData,
  migrations: DataMigration[] = dataMigrations,
  ctx: Partial<DataMigrationContext> = {},
): Promise<DataMigrationReport> {
  return applyOrmMigrations(ormFromProductData(data), migrations, { store: "aggregate", ...ctx }, data);
}

export { createMemoryOrm, ormFromProductData };

export function shouldPersistDataMigrationsOnBoot(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env) {
  return env.APP_ENV === "DEV" || env.APP_ENV === "SIT";
}

export function assertCloudDataConfirm() {
  if (process.env.CONFIRM_DATA_SYNC !== "learning-guide/dev" && process.env.CONFIRM_CATALOGUE_SYNC !== "learning-guide/dev") {
    throw new Error("Cloud data update requires CONFIRM_DATA_SYNC=learning-guide/dev (or CONFIRM_CATALOGUE_SYNC=learning-guide/dev).");
  }
  if (process.env.DATA_S3_PREFIX !== "learning-guide/dev" || process.env.APP_ENV !== "DEV") {
    throw new Error("Cloud data update requires DATA_S3_PREFIX=learning-guide/dev and APP_ENV=DEV.");
  }
}

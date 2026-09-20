import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { dataMigrations, type DataChange } from "../db/data-migrations";
import { DATA_MIGRATION_ID, type DataMigration, type DataMigrationContext, type DataMigrationDomain } from "../db/data-migrations/types";
import type { ProductData } from "./productStore";

export type DataMigrationReport = {
  applied: string[];
  skipped: string[];
  changes: Array<DataChange & { migration: string }>;
  plans: Array<{ migration: string; sql: number; objects: number }>;
};

const PROTECTED_KEYS = [
  "users",
  "sessions",
  "accounts",
  "orders",
  "quotes",
  "subscriptions",
  "entitlements",
  "studyRecords",
  "studyEvents",
  "conversations",
  "notifications",
  "verificationTokens",
  "passwordResetTokens",
  "emailBindingTokens",
  "stripeEvents",
] as const;

const KEY_TO_DOMAIN: Record<(typeof PROTECTED_KEYS)[number], DataMigrationDomain> = {
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

function recordedIds(data: ProductData) {
  return new Set([...(data.dataMigrations || []), ...(data.catalogueMigrations || [])]);
}

function snapshot(value: unknown) {
  return JSON.stringify(value);
}

function assertTouches(before: ProductData, after: ProductData, touches: readonly string[], migrationId: string) {
  const allowed = new Set(touches);
  for (const key of PROTECTED_KEYS) {
    const domain = KEY_TO_DOMAIN[key];
    if (allowed.has(domain) || allowed.has(key)) continue;
    if (snapshot(before[key]) !== snapshot(after[key])) {
      throw new Error(`Migration ${migrationId} changed ${key} without declaring touches: ["${domain}"].`);
    }
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
  return { store: "aggregate", dryRun: false, now: new Date().toISOString(), ...overrides };
}

export async function applyDataMigrations(
  data: ProductData,
  migrations: DataMigration[] = dataMigrations,
  ctx: Partial<DataMigrationContext> = {},
): Promise<DataMigrationReport> {
  validateDataMigrations(migrations);
  if (migrations === dataMigrations) assertMigrationRegistry(migrations);
  data.dataMigrations ||= [];
  data.catalogueMigrations ||= [];
  const seen = recordedIds(data);
  const context = defaultContext(ctx);
  const report: DataMigrationReport = { applied: [], skipped: [], changes: [], plans: [] };
  for (const migration of migrations) {
    if (seen.has(migration.id)) {
      report.skipped.push(migration.id);
      continue;
    }
    const before = structuredClone(data);
    const changes = await migration.apply(data, context);
    assertTouches(before, data, migration.touches, migration.id);
    report.changes.push(...changes.map((change) => ({ ...change, migration: migration.id })));
    if (migration.plan) {
      const planned = await migration.plan(context);
      report.plans.push({ migration: migration.id, sql: planned.sql?.length || 0, objects: planned.objects?.length || 0 });
    }
    data.dataMigrations.push(migration.id);
    if (!data.catalogueMigrations.includes(migration.id)) data.catalogueMigrations.push(migration.id);
    seen.add(migration.id);
    if (changes.some((change) => change.action === "add" || change.action === "update")) report.applied.push(migration.id);
    else report.skipped.push(migration.id);
  }
  return report;
}

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

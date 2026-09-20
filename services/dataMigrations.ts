import { dataMigrations, type DataChange } from "../db/data-migrations";
import type { ProductData } from "./productStore";

export type DataMigrationReport = {
  applied: string[];
  skipped: string[];
  changes: Array<DataChange & { migration: string }>;
};

function recordedIds(data: ProductData) {
  return new Set([...(data.dataMigrations || []), ...(data.catalogueMigrations || [])]);
}

export function applyDataMigrations(data: ProductData, migrations = dataMigrations): DataMigrationReport {
  data.dataMigrations ||= [];
  data.catalogueMigrations ||= [];
  const seen = recordedIds(data);
  const report: DataMigrationReport = { applied: [], skipped: [], changes: [] };
  for (const migration of migrations) {
    if (seen.has(migration.id)) {
      report.skipped.push(migration.id);
      continue;
    }
    const changes = migration.apply(data);
    report.changes.push(...changes.map((change) => ({ ...change, migration: migration.id })));
    data.dataMigrations.push(migration.id);
    if (!data.catalogueMigrations.includes(migration.id)) data.catalogueMigrations.push(migration.id);
    seen.add(migration.id);
    if (changes.some((change) => change.action === "add" || change.action === "update")) report.applied.push(migration.id);
    else report.skipped.push(migration.id);
  }
  return report;
}

export function assertCloudDataConfirm() {
  if (process.env.CONFIRM_DATA_SYNC !== "learning-guide/dev" && process.env.CONFIRM_CATALOGUE_SYNC !== "learning-guide/dev") {
    throw new Error("Cloud data update requires CONFIRM_DATA_SYNC=learning-guide/dev (or CONFIRM_CATALOGUE_SYNC=learning-guide/dev).");
  }
  if (process.env.DATA_S3_PREFIX !== "learning-guide/dev" || process.env.APP_ENV !== "DEV") {
    throw new Error("Cloud data update requires DATA_S3_PREFIX=learning-guide/dev and APP_ENV=DEV.");
  }
}

import { catalogueMigrations, type CatalogueChange } from "../db/catalogue-migrations";
import type { ProductCourse, ProductData } from "./productStore";
import type { PortalContent } from "@/lib/portalContent";

export type CatalogueReport = {
  applied: string[];
  skipped: string[];
  changes: Array<CatalogueChange & { migration: string }>;
};

export type CatalogueSlice = {
  version: 1;
  courses: ProductCourse[];
  portalContent?: PortalContent;
  catalogueMigrations: string[];
};

export function applyCatalogueMigrations(data: ProductData): CatalogueReport {
  data.catalogueMigrations ||= [];
  const report: CatalogueReport = { applied: [], skipped: [], changes: [] };
  for (const migration of catalogueMigrations) {
    if (data.catalogueMigrations.includes(migration.id)) {
      report.skipped.push(migration.id);
      continue;
    }
    const changes = migration.apply(data);
    report.changes.push(...changes.map((change) => ({ ...change, migration: migration.id })));
    data.catalogueMigrations.push(migration.id);
    if (changes.some((change) => change.action === "add")) report.applied.push(migration.id);
    else report.skipped.push(migration.id);
  }
  return report;
}

export function exportCatalogueSlice(data: ProductData): CatalogueSlice {
  return {
    version: 1,
    courses: data.courses,
    portalContent: data.portalContent,
    catalogueMigrations: [...(data.catalogueMigrations || [])],
  };
}

export function assertCloudCatalogueConfirm() {
  if (process.env.CONFIRM_CATALOGUE_SYNC !== "learning-guide/dev" || process.env.DATA_S3_PREFIX !== "learning-guide/dev" || process.env.APP_ENV !== "DEV") {
    throw new Error("Cloud catalogue update requires CONFIRM_CATALOGUE_SYNC=learning-guide/dev, DATA_S3_PREFIX=learning-guide/dev and APP_ENV=DEV.");
  }
}

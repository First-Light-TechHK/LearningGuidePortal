import { applyDataMigrations, type DataMigrationReport } from "./dataMigrations";
import type { ProductCourse, ProductData } from "./productStore";
import type { PortalContent } from "@/lib/portalContent";

export type CatalogueReport = DataMigrationReport;

export type CatalogueSlice = {
  version: 1;
  courses: ProductCourse[];
  portalContent?: PortalContent;
  catalogueMigrations: string[];
};

export function applyCatalogueMigrations(data: ProductData): CatalogueReport {
  return applyDataMigrations(data);
}

export function exportCatalogueSlice(data: ProductData): CatalogueSlice {
  return {
    version: 1,
    courses: data.courses,
    portalContent: data.portalContent,
    catalogueMigrations: [...(data.catalogueMigrations || data.dataMigrations || [])],
  };
}

export { assertCloudDataConfirm as assertCloudCatalogueConfirm } from "./dataMigrations";

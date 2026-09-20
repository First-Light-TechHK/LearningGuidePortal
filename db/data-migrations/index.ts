import type { DataMigration } from "./types";
import * as addStoicism from "./001_add_stoicism";

export const dataMigrations: DataMigration[] = [addStoicism];
export { type DataChange, type DataMigration, type DataMigrationContext, type DataMigrationDomain, type DataMigrationPlan } from "./types";

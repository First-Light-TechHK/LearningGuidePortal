import type { DataMigration } from "./types";
import * as addStoicism from "./001_add_stoicism";
import * as gitDevRdsProbe from "./002_git_dev_rds_probe";

export const dataMigrations: DataMigration[] = [addStoicism, gitDevRdsProbe];
export { type DataChange, type DataMigration, type DataMigrationContext, type DataMigrationDomain } from "./types";

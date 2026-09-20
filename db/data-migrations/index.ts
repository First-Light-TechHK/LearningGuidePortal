import type { DataMigration } from "./types";
import * as addStoicism from "./001_add_stoicism";
import * as gitDevRdsProbe from "./002_git_dev_rds_probe";
import * as addQuintusHoratiusFlaccus from "./003_add_quintus_horatius_flaccus";

export const dataMigrations: DataMigration[] = [addStoicism, gitDevRdsProbe, addQuintusHoratiusFlaccus];
export { type DataChange, type DataMigration, type DataMigrationContext, type DataMigrationDomain } from "./types";

import type { DataMigration } from "./types";
import * as addStoicism from "../catalogue-migrations/001_add_stoicism";

export const dataMigrations: DataMigration[] = [addStoicism];
export { type DataChange, type DataMigration } from "./types";

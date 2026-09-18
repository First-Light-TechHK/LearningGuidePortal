import type { CatalogueMigration } from "./types";
import * as addStoicism from "./001_add_stoicism";

export const catalogueMigrations: CatalogueMigration[] = [addStoicism];
export { type CatalogueChange, type CatalogueMigration } from "./types";

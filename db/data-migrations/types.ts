import type { ProductData } from "../../services/productStore";

export const DATA_MIGRATION_ID = /^\d{3}_[a-z0-9_]+$/;

/** Domains a script may change. Declare every aggregate key you mutate. */
export type DataMigrationDomain =
  | "courses"
  | "plans"
  | "portalContent"
  | "paymentSettings"
  | "catalogue"
  | "media"
  | "users"
  | "sessions"
  | "accounts"
  | "orders"
  | "quotes"
  | "subscriptions"
  | "entitlements"
  | "studyRecords"
  | "studyEvents"
  | "conversations"
  | "notifications"
  | "tokens"
  | "other";

export type DataChange = {
  action: "add" | "update" | "skip";
  kind: string;
  id: string;
  reason?: string;
};

export type DataMigrationStore = "aggregate" | "sql";

export type DataMigrationContext = {
  /** Today always `aggregate`. The SQL/S3 adapter will pass `sql`. */
  store: DataMigrationStore;
  dryRun: boolean;
  now: string;
};

/** Portable side effects for the future SQL/S3 runner. The aggregate runner records but does not execute them. */
export type DataMigrationPlan = {
  sql?: string[];
  objects?: Array<{ key: string; source: string; contentType: string }>;
};

export type DataMigration = {
  id: string;
  description: string;
  touches: readonly DataMigrationDomain[];
  apply: (data: ProductData, ctx: DataMigrationContext) => DataChange[] | Promise<DataChange[]>;
  plan?: (ctx: DataMigrationContext) => DataMigrationPlan | Promise<DataMigrationPlan>;
};

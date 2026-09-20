import type { MigrationOrm } from "../../services/migrationOrm";

export const DATA_MIGRATION_ID = /^\d{3}_[a-z0-9_]+$/;

export type DataMigrationDomain =
  | "courses"
  | "plans"
  | "portalContent"
  | "paymentSettings"
  | "catalogue"
  | "files"
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

export type DataMigrationContext = {
  /** CI and unit tests use memory. App Runner DEV persist uses aggregate/VFS. */
  store: "memory" | "aggregate";
  dryRun: boolean;
  now: string;
};

export type DataMigration = {
  id: string;
  description: string;
  touches: readonly DataMigrationDomain[];
  apply: (orm: MigrationOrm, ctx: DataMigrationContext) => DataChange[] | Promise<DataChange[]>;
};

import type { MigrationOrm } from "../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "./types";

export const id = "002_git_dev_rds_probe";
export const description = "Prove git-to-dev boot persist writes an extra table row into RDS orm_rows.";
export const touches = ["other"] as const;

export function apply(orm: MigrationOrm, _ctx: DataMigrationContext): DataChange[] {
  const rows = orm.table<{ id: string; source: string }>("git_dev_rds_probes");
  if (rows.findById("2026-09-20-full-rds")) {
    return [{ action: "skip", kind: "git_dev_rds_probes", id: "2026-09-20-full-rds", reason: "exists" }];
  }
  rows.insert({ id: "2026-09-20-full-rds", source: "git-dev" });
  return [{ action: "add", kind: "git_dev_rds_probes", id: "2026-09-20-full-rds" }];
}

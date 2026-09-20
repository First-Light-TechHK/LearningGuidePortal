import type { MigrationOrm } from "../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "./types";

export const id = "00N_your_name";
export const description = "One sentence: what logical row or file changes.";
export const touches = ["other"] as const;

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const rows = orm.table<{ id: string; title: string }>("example_items");
  if (rows.findById("example")) return [{ action: "skip", kind: "example_items", id: "example", reason: "exists" }];
  rows.insert({ id: "example", title: `Seeded at ${ctx.now}` });
  return [{ action: "add", kind: "example_items", id: "example" }];
}

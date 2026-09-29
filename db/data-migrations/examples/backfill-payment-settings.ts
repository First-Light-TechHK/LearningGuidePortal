/**
 * COPY ME. Teaching material only. Scaffold a real file, then paste.
 *   npm run data:migration:new -- rename_payment_display
 *
 * Documents use orm.doc, not orm.table. Prefer patch over set so you do not
 * wipe keys an operator already edited.
 */
import type { MigrationOrm } from "../../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "../types";

export const id = "094_example_backfill_payment_name";
export const description = "Rename the Stripe display name when it is still the generic default.";
export const touches = ["paymentSettings"] as const;

const TARGET = "Learning Guide Stripe";

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  void ctx;
  const settings = orm.doc<{ name: string }>("paymentSettings");
  if (settings.get()?.name === TARGET) {
    return [{ action: "skip", kind: "paymentSettings", id: "paymentSettings", reason: "current" }];
  }
  settings.patch({ name: TARGET });
  return [{ action: "update", kind: "paymentSettings", id: "paymentSettings" }];
}

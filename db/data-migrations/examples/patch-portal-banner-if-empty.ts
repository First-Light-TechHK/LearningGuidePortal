/**
 * COPY ME. Teaching material only. Scaffold a real file, then paste.
 *   npm run data:migration:new -- set_support_url_if_empty
 */
import type { PortalContent } from "../../../lib/portalContent";
import type { MigrationOrm } from "../../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "../types";

export const id = "092_example_patch_portal_if_empty";
export const description = "Set the portal support URL only when operators have not already filled it.";
export const touches = ["portalContent"] as const;

const SUPPORT_URL = "https://www.ilovelearningguide.com/support";

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  void ctx;
  const doc = orm.doc<PortalContent>("portalContent");
  const current = doc.get();
  if (!current) return [{ action: "skip", kind: "portalContent", id: "portalContent", reason: "missing" }];
  if (current.supportUrl?.trim()) {
    return [{ action: "skip", kind: "portalContent", id: "supportUrl", reason: "operator-set" }];
  }
  doc.patch({ supportUrl: SUPPORT_URL });
  return [{ action: "update", kind: "portalContent", id: "supportUrl" }];
}

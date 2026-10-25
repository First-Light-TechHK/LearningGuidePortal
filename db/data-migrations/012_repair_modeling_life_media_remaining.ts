import type { MigrationOrm } from "../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "./types";
import { MEDIA, ensureMedia } from "./006_add_modeling_life_course";

export const id = "012_repair_modeling_life_media_remaining";
export const description = "Finish the Modeling life media copy asset by asset.";
export const touches = ["media"] as const;

export async function apply(_orm: MigrationOrm, ctx: DataMigrationContext): Promise<DataChange[]> {
  const changes: DataChange[] = [];
  if (ctx.store !== "sql") return [{ action: "skip", kind: "course-media", id: "modeling-life", reason: "not-managed-store" }];
  for (const asset of MEDIA) {
    try {
      changes.push({ action: await ensureMedia(asset), kind: "course-media", id: asset.id });
    } catch (error) {
      changes.push({ action: "skip", kind: "course-media", id: asset.id, reason: error instanceof Error ? error.message : "failed" });
    }
  }
  return changes;
}

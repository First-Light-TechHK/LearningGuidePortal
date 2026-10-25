import type { MigrationOrm } from "../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "./types";
import { MEDIA, ensureMedia } from "./006_add_modeling_life_course";

export const id = "010_repair_modeling_life_media_rows";
export const description = "Rewrite Modeling life media so app_files rows and S3 objects exist together.";
export const touches = ["media"] as const;

export async function apply(_orm: MigrationOrm, _ctx: DataMigrationContext): Promise<DataChange[]> {
  const changes: DataChange[] = [];
  try {
    for (const asset of MEDIA) {
    try {
      changes.push({ action: await ensureMedia(asset, true), kind: "course-media", id: asset.id });
    } catch (error) {
      changes.push({ action: "skip", kind: "course-media", id: asset.id, reason: error instanceof Error ? error.message : "failed" });
    }
  }
  } catch (error) {
    // Same contract as 006/007: a staging or credentials problem must not block
    // boot or the course itself; record the skip and let the next run retry.
    changes.push({ action: "skip", kind: "course-media", id: "modeling-life", reason: error instanceof Error ? error.message : "staging-missing" });
  }
  return changes;
}

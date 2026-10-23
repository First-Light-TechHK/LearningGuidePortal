import type { MigrationOrm } from "../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "./types";
import { MEDIA, ensureMedia } from "./006_add_modeling_life_course";

export const id = "009_repair_modeling_life_media_rows";
export const description = "Rewrite Modeling life media so app_files rows and S3 objects exist together.";
export const touches = ["media"] as const;

export async function apply(_orm: MigrationOrm, _ctx: DataMigrationContext): Promise<DataChange[]> {
  const changes: DataChange[] = [];
  for (const asset of MEDIA) changes.push({ action: await ensureMedia(asset, true), kind: "course-media", id: asset.id });
  return changes;
}

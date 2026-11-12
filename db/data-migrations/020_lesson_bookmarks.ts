import type { ProductStudyRecord } from "../../services/productStore";
import type { MigrationOrm } from "../../services/migrationOrm";
import type { DataChange } from "./types";

export const id = "020_lesson_bookmarks";
export const description = "Initialise empty independent Lesson bookmarks without inventing timestamps or paragraphs from legacy cursors.";
export const touches = ["studyRecords"] as const;
export function apply(orm: MigrationOrm): DataChange[] {
  const records = orm.table<ProductStudyRecord>("studyRecords");
  return records.all().map(record => {
    if (record.lessonBookmarks !== undefined) return { action: "skip", kind: "studyRecords", id: record.id, reason: "exists" };
    records.update(record.id, { lessonBookmarks: {} });
    return { action: "update", kind: "studyRecords", id: record.id };
  });
}

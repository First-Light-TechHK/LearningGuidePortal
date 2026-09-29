/**
 * COPY ME. Teaching material only. Scaffold a real file, then paste.
 *   npm run data:migration:new -- add_public_policy_wiki
 *
 * Extra tables are not ProductData columns. Declare touches: ["other", "files"].
 * AWS stores the row in orm_rows and the markdown in app_files (S3 if binary/large).
 */
import type { MigrationOrm } from "../../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "../types";

export const id = "093_example_add_wiki_page";
export const description = "Seed the Public policy wiki page and its markdown file.";
export const touches = ["other", "files"] as const;

const PAGE_ID = "public-policy";
const FILE_PATH = "courses/economics/knowledge/public-policy/wiki/page.md";

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const pages = orm.table<{ id: string; title: string; courseId: string; updatedAt: string }>("wiki_pages");
  if (pages.findById(PAGE_ID) && orm.files.exists(FILE_PATH)) {
    return [{ action: "skip", kind: "wiki_pages", id: PAGE_ID, reason: "exists" }];
  }
  if (!pages.findById(PAGE_ID)) {
    pages.insert({
      id: PAGE_ID,
      title: "Public policy",
      courseId: "economics",
      updatedAt: ctx.now,
    });
  }
  if (!orm.files.exists(FILE_PATH)) {
    orm.files.writeText(FILE_PATH, `# Public policy\n\nA first knowledge page seeded by a data migration.\n`);
  }
  return [{ action: "add", kind: "wiki_pages", id: PAGE_ID }];
}

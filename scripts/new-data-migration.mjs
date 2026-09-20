import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const directory = path.join(root, "db/data-migrations");
const slug = (process.argv[2] || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
if (!slug) {
  console.error("Usage: npm run data:migration:new -- add_example_course");
  process.exit(1);
}

const used = readdirSync(directory)
  .map((name) => name.match(/^(\d{3})_/)?.[1])
  .filter(Boolean)
  .map((value) => Number(value));
const next = String((used.length ? Math.max(...used) : 0) + 1).padStart(3, "0");
const id = `${next}_${slug}`;
const file = path.join(directory, `${id}.ts`);
const alias = `migration${next}`;
writeFileSync(file, `import type { ProductData } from "../../services/productStore";
import type { DataChange, DataMigrationContext } from "./types";

export const id = ${JSON.stringify(id)};
export const description = "Describe the logical change.";
export const touches = ["courses"] as const;

export function apply(data: ProductData, ctx: DataMigrationContext): DataChange[] {
  void data;
  void ctx;
  return [{ action: "skip", kind: "course", id: "replace-me", reason: "todo" }];
}

export function plan() {
  return { sql: [] as string[], objects: [] as Array<{ key: string; source: string; contentType: string }> };
}
`);

const indexPath = path.join(directory, "index.ts");
const index = readFileSync(indexPath, "utf8");
if (!index.includes(`"./${id}"`)) {
  const withImport = index.replace(
    'import type { DataMigration } from "./types";\n',
    `import type { DataMigration } from "./types";\nimport * as ${alias} from "./${id}";\n`,
  );
  const withList = withImport.replace(/export const dataMigrations: DataMigration\[\] = \[([^\]]*)\];/, (_match, inner) => {
    const items = inner.split(",").map((item) => item.trim()).filter(Boolean);
    items.push(alias);
    return `export const dataMigrations: DataMigration[] = [${items.join(", ")}];`;
  });
  writeFileSync(indexPath, withList);
}
console.log(JSON.stringify({ id, file: path.relative(root, file) }));

import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOrmMigrationsWithPlan, createMemoryOrm } from "../../services/dataMigrations";
import type { DataMigration } from "../../db/data-migrations/types";
import { compileOrmOps, executeOrmPlan, recordOrm } from "../../services/ormRuntime";

const wiki: DataMigration = {
  id: "010_compile_wiki",
  description: "Compile extra table and file writes.",
  touches: ["other", "files"],
  apply(orm) {
    const pages = orm.table<{ id: string; title: string }>("wiki_pages");
    pages.insert({ id: "public-policy", title: "Public policy" });
    orm.files.writeText("courses/economics/knowledge/public-policy/wiki/page.md", "# Public policy\n");
    return [{ action: "add", kind: "wiki_pages", id: "public-policy" }];
  },
};

const course: DataMigration = {
  id: "011_compile_course",
  description: "Compile a product course insert.",
  touches: ["courses"],
  apply(orm) {
    orm.table("courses").insert({ id: "roman-history" });
    return [{ action: "add", kind: "course", id: "roman-history" }];
  },
};

test("AWS compile maps extra tables to orm_rows and markdown to app_files SQL", async () => {
  const { report, plan } = await applyOrmMigrationsWithPlan(createMemoryOrm(), [wiki], { store: "sql" });
  assert.deepEqual(report.applied, ["010_compile_wiki"]);
  assert.equal(report.sql, plan.sql.length);
  assert.equal(report.objects, 0);
  assert.match(plan.sql.map((item) => item.text).join("\n"), /INSERT INTO orm_rows/);
  assert.match(plan.sql.map((item) => item.text).join("\n"), /INSERT INTO app_files/);
  assert.match(plan.sql.map((item) => item.text).join("\n"), /INSERT INTO data_migrations/);
  assert.equal(plan.sql.some((item) => item.values.includes("public-policy") && item.values.includes("wiki_pages")), true);
  assert.equal(plan.productTouched, false);
  assert.equal(process.env.DATABASE_URL || "", "");
});

test("AWS compile maps product rows to the aggregate update, not a courses table", async () => {
  const { plan } = await applyOrmMigrationsWithPlan(createMemoryOrm(), [course], { store: "sql" });
  assert.equal(plan.productTouched, true);
  assert.equal(plan.sql.some((item) => item.text.includes("orm_rows") && String(item.values[0]) === "courses"), false);
  assert.equal(plan.sql.some((item) => item.text.includes("data_migrations") && item.values[0] === "011_compile_course"), true);
});

test("binary ORM files compile to S3 objects plus app_files pointers", () => {
  const recorded = recordOrm(createMemoryOrm());
  recorded.orm.files.writeText("covers/stoicism.png", "fakepng");
  const plan = compileOrmOps(recorded.ops, { s3Prefix: "learning-guide/dev" });
  assert.equal(plan.objects.length, 1);
  assert.equal(plan.objects[0].key, "learning-guide/dev/learning_guide/orm/covers/stoicism.png");
  assert.match(plan.sql[0].text, /storage, content, s3_key/);
  assert.equal(plan.sql[0].values[1], plan.objects[0].key);
});

test("executeOrmPlan runs compiled SQL and S3 puts without a real database", async () => {
  const { plan } = await applyOrmMigrationsWithPlan(createMemoryOrm(), [wiki], { store: "sql" });
  const sql: Array<{ text: string; values: unknown[] }> = [];
  const objects: Array<{ path: string; type: string }> = [];
  await executeOrmPlan(plan, {
    query: async (text, values = []) => {
      sql.push({ text, values });
      return { rows: [] };
    },
  }, async (relativePath, _body, contentType) => {
    objects.push({ path: relativePath, type: contentType });
    return relativePath;
  });
  assert.equal(sql.length, plan.sql.length);
  assert.equal(objects.length, plan.objects.length);
  assert.equal(process.env.DATABASE_URL || "", "");
});

import { writeFile } from "node:fs/promises";
import { applyCatalogueMigrations, assertCloudCatalogueConfirm, exportCatalogueSlice } from "../services/catalogueMigrations";
import { ensureProductData, persistCatalogueMigrations, readProductAggregate } from "../services/productStore";
import { getPool } from "../services/persistence/db";

function wants(flag: string) {
  return process.argv.includes(flag);
}

async function applyCloud() {
  assertCloudCatalogueConfirm();
  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await db.query("SELECT storage, content FROM app_files WHERE path = $1 FOR UPDATE", ["learning_guide/product.json"]);
    const row = result.rows[0];
    if (!row || row.storage !== "db") throw new Error("Expected an existing database catalogue; no data was changed.");
    const data = JSON.parse(row.content);
    if (!Array.isArray(data.courses) || !Array.isArray(data.users)) throw new Error("Unexpected catalogue structure.");
    const users = data.users.length;
    const report = applyCatalogueMigrations(data);
    if (data.users.length !== users) throw new Error("Catalogue migration tried to change users; aborted.");
    if (!wants("--apply")) {
      await db.query("ROLLBACK");
      return { ...report, storage: "postgresql", persisted: false };
    }
    const content = JSON.stringify(data);
    await db.query("UPDATE app_files SET content=$1, byte_size=$2, updated_at=NOW() WHERE path=$3", [content, Buffer.byteLength(content), "learning_guide/product.json"]);
    await db.query("COMMIT");
    return { ...report, storage: "postgresql", persisted: true };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
    await pool.end();
  }
}

async function main() {
  const exportPath = process.argv.find((item, index, all) => all[index - 1] === "--export");
  if (wants("--cloud")) {
    const report = await applyCloud();
    console.log(JSON.stringify(report));
    return;
  }
  if (exportPath) {
    const data = await ensureProductData();
    await writeFile(exportPath, `${JSON.stringify(exportCatalogueSlice(data), null, 2)}\n`);
    console.log(JSON.stringify({ exported: exportPath, courses: data.courses.map((course) => course.id) }));
    return;
  }
  if (wants("--apply")) {
    console.log(JSON.stringify({ ...(await persistCatalogueMigrations()), persisted: true, storage: "local" }));
    return;
  }
  const data = structuredClone(await readProductAggregate());
  const users = data.users.length;
  const report = applyCatalogueMigrations(data);
  if (users !== data.users.length) throw new Error("Dry-run clone leaked into live users.");
  console.log(JSON.stringify({ ...report, persisted: false, storage: "local" }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

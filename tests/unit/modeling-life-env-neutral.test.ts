import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("course migrations never hardcode an environment bucket address", async () => {
  const dir = path.join(process.cwd(), "db/data-migrations");
  for (const file of await readdir(dir)) {
    if (!file.endsWith(".ts") || file === "011_fix_modeling_life_media_urls.ts") continue;
    const text = await readFile(path.join(dir, file), "utf8");
    assert.equal(/https:\/\/[a-z0-9.-]*s3[^"']*\/(learning-guide|staging)\//.test(text), false, file);
  }
});

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.join(process.cwd(), "db/data-migrations");
const FORBIDDEN = /amazonaws\.com|myqcloud\.com|\.s3[.-]|s3Get\s*\(|s3Put\s*\(|s3Head(?:Raw)?\s*\(|toS3Key\s*\(|ensureMedia\s*\(|HeadObjectCommand|GetObjectCommand|PutObjectCommand/;

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const file = path.join(directory, name);
    return statSync(file).isDirectory() ? walk(file) : [file];
  });
}

test("data migrations contain course data only: no bucket hosts and no S3 helpers", () => {
  const offenders = walk(ROOT)
    .filter((file) => file.endsWith(".ts"))
    .flatMap((file) => {
      const hits = readFileSync(file, "utf8").split(/\n/).flatMap((line, index) => FORBIDDEN.test(line) ? [`${path.relative(process.cwd(), file)}:${index + 1}`] : []);
      return hits;
    });
  assert.deepEqual(offenders, []);
});

import assert from "node:assert/strict";
import { after, test } from "node:test";

// Review corner (no new BugID): /api/health/persistence must not leak
// bucket / prefix / rowCount to an unauthenticated caller.

const originalBucket = process.env.DATA_S3_BUCKET;
const originalPrefix = process.env.DATA_S3_PREFIX;

after(() => {
  if (originalBucket === undefined) delete process.env.DATA_S3_BUCKET;
  else process.env.DATA_S3_BUCKET = originalBucket;
  if (originalPrefix === undefined) delete process.env.DATA_S3_PREFIX;
  else process.env.DATA_S3_PREFIX = originalPrefix;
});

test("health persistence JSON omits bucket, prefix, and rowCount", async () => {
  process.env.DATA_S3_BUCKET = "secret-bucket-name-must-not-leak";
  process.env.DATA_S3_PREFIX = "secret-prefix-must-not-leak";
  const { GET } = await import("../../app/api/health/persistence/route");
  const response = await GET();
  const body = await response.json() as Record<string, unknown>;
  assert.equal("bucket" in body, false);
  assert.equal("prefix" in body, false);
  assert.equal("rowCount" in body, false);
  assert.equal(JSON.stringify(body).includes("secret-bucket-name-must-not-leak"), false);
  assert.equal(JSON.stringify(body).includes("secret-prefix-must-not-leak"), false);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { rawMediaKey } from "../../services/persistence/s3";

test("raw course media keys stay environment-neutral and pick up DATA_S3_PREFIX", () => {
  const original = process.env.DATA_S3_PREFIX;
  process.env.DATA_S3_PREFIX = "learning-guide/dev";
  try {
    assert.equal(
      rawMediaKey("course-media/modeling-life/04f0039b-42c7-441b-85b7-fe6e21c6bbe6.mp4"),
      "learning-guide/dev/course-media/modeling-life/04f0039b-42c7-441b-85b7-fe6e21c6bbe6.mp4",
    );
  } finally {
    if (original === undefined) delete process.env.DATA_S3_PREFIX;
    else process.env.DATA_S3_PREFIX = original;
  }
});

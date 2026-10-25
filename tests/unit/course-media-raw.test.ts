import assert from "node:assert/strict";
import { test } from "node:test";
import { rawMediaKey } from "../../services/persistence/s3";

test("raw course media keys stay environment-neutral and pick up DATA_S3_PREFIX", () => {
  const original = process.env.DATA_S3_PREFIX;
  process.env.DATA_S3_PREFIX = "learning-guide/sit";
  try {
    assert.equal(
      rawMediaKey("course-media/modeling-life/613a07b1-24e8-4123-ab10-5bd36875293e.mp4"),
      "learning-guide/sit/course-media/modeling-life/613a07b1-24e8-4123-ab10-5bd36875293e.mp4",
    );
  } finally {
    if (original === undefined) delete process.env.DATA_S3_PREFIX;
    else process.env.DATA_S3_PREFIX = original;
  }
});

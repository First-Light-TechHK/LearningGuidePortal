import assert from "node:assert/strict";
import { test } from "node:test";
import { rawMediaKey } from "../../services/persistence/s3";
import { RAW_MEDIA_EXTENSIONS, RAW_MEDIA_HIT_TTL_MS, RAW_MEDIA_MISS_TTL_MS, findRawCourseMediaKey, resetRawCourseMediaCache } from "../../services/courseMediaRaw";

const COURSE = "modeling-life";
const ASSET = "613a07b1-24e8-4123-ab10-5bd36875293e";

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

test("a raw media hit is cached and re-checked after its hit TTL", async () => {
  resetRawCourseMediaCache();
  let now = 1_000_000;
  let heads = 0;
  const head = async (key: string) => { heads += 1; return key.endsWith(".mp4"); };
  const deps = { head, now: () => now };
  assert.equal(await findRawCourseMediaKey(COURSE, ASSET, deps), `course-media/${COURSE}/${ASSET}.mp4`);
  assert.equal(heads, 1);
  assert.equal(await findRawCourseMediaKey(COURSE, ASSET, deps), `course-media/${COURSE}/${ASSET}.mp4`);
  assert.equal(heads, 1);
  now += RAW_MEDIA_HIT_TTL_MS + 1;
  assert.equal(await findRawCourseMediaKey(COURSE, ASSET, deps), `course-media/${COURSE}/${ASSET}.mp4`);
  assert.equal(heads, 2, "a deleted/replaced raw object is re-discovered after the hit TTL");
});

test("a raw media miss is re-checked after a short TTL instead of pinning the whole-object fallback", async () => {
  resetRawCourseMediaCache();
  let now = 1_000_000;
  let heads = 0;
  const head = async () => { heads += 1; return false; };
  const deps = { head, now: () => now };
  assert.equal(await findRawCourseMediaKey(COURSE, ASSET, deps), null);
  assert.equal(heads, RAW_MEDIA_EXTENSIONS.length);
  await Promise.resolve();
  assert.equal(await findRawCourseMediaKey(COURSE, ASSET, deps), null);
  assert.equal(heads, RAW_MEDIA_EXTENSIONS.length, "a miss is cached for the TTL window");
  now += RAW_MEDIA_MISS_TTL_MS + 1;
  assert.equal(await findRawCourseMediaKey(COURSE, ASSET, deps), null);
  assert.equal(heads, RAW_MEDIA_EXTENSIONS.length * 2, "the lookup retries after the TTL");
});

test("concurrent raw lookups share one in-flight promise", async () => {
  resetRawCourseMediaCache();
  let heads = 0;
  const head = async (key: string) => { heads += 1; await Promise.resolve(); return key.endsWith(".mp4"); };
  const deps = { head, now: () => 1_000_000 };
  const [first, second] = await Promise.all([
    findRawCourseMediaKey(COURSE, ASSET, deps),
    findRawCourseMediaKey(COURSE, ASSET, deps),
  ]);
  assert.equal(first, `course-media/${COURSE}/${ASSET}.mp4`);
  assert.equal(second, first);
  assert.equal(heads, 1, "the second caller reuses the in-flight promise");
});

test("a rejected HEAD lookup is not cached", async () => {
  resetRawCourseMediaCache();
  let attempts = 0;
  const head = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("transient");
    return true;
  };
  const deps = { head, now: () => 1_000_000 };
  await assert.rejects(() => findRawCourseMediaKey(COURSE, ASSET, deps), /transient/);
  assert.equal(await findRawCourseMediaKey(COURSE, ASSET, deps), `course-media/${COURSE}/${ASSET}.mp4`);
});

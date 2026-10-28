import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CourseMediaError, STORED_RANGE_CHUNK_BYTES, boundStoredRange, readStoredAssetRange } from "../../services/courseMedia";

const COURSE = "modeling-life";
const ASSET = "11111111-1111-4111-8111-111111111111";

function storedAsset(media: Buffer, assetId = ASSET) {
  const header = Buffer.from(JSON.stringify({
    id: assetId,
    courseId: COURSE,
    url: `/api/course-media/${COURSE}/${assetId}`,
    size: media.length,
  }));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  return Buffer.concat([length, header, media]);
}

test("an open-ended browser range is capped and a suffix range keeps the file tail", () => {
  const end = STORED_RANGE_CHUNK_BYTES * 3;
  assert.deepEqual(boundStoredRange({ start: 0, end }), { start: 0, end: STORED_RANGE_CHUNK_BYTES - 1 });
  assert.deepEqual(boundStoredRange({ start: 1000, end }, true), { start: end - STORED_RANGE_CHUNK_BYTES + 1, end });
  assert.deepEqual(boundStoredRange({ start: 5, end: 9 }), { start: 5, end: 9 });
  assert.equal(boundStoredRange(null), null);
});

test("stored media ranges read only the requested bytes and bound the range", async () => {
  const environment = { ...process.env };
  const root = await mkdtemp(path.join(tmpdir(), "lg-media-range-"));
  try {
    Object.assign(process.env, { STORAGE_BACKEND: "local", APP_ENV: "test" });
    delete process.env.DATABASE_URL;
    delete process.env.DATA_S3_BUCKET;
    const media = Buffer.from(Array.from({ length: 64 }, (_, index) => index));
    const directory = path.join(root, "course_media", COURSE);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${ASSET}.bin`), storedAsset(media));

    const slice = await readStoredAssetRange(COURSE, ASSET, 10, 19, root);
    assert.deepEqual([...slice.bytes], [...media.subarray(10, 20)]);
    assert.equal(slice.size, media.length);
    assert.equal(slice.asset.id, ASSET);

    await assert.rejects(
      () => readStoredAssetRange(COURSE, ASSET, 60, 70, root),
      (error: unknown) => error instanceof CourseMediaError && error.status === 416,
    );
  } finally {
    process.env = environment;
    await rm(root, { recursive: true, force: true });
  }
});

test("a zero-length container header fails as invalid stored media", async () => {
  const environment = { ...process.env };
  const root = await mkdtemp(path.join(tmpdir(), "lg-media-bad-header-"));
  const assetId = "22222222-2222-4222-8222-222222222222";
  try {
    Object.assign(process.env, { STORAGE_BACKEND: "local", APP_ENV: "test" });
    delete process.env.DATABASE_URL;
    delete process.env.DATA_S3_BUCKET;
    const directory = path.join(root, "course_media", COURSE);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${assetId}.bin`), Buffer.from([0, 0, 0, 0, 1, 2, 3]));
    await assert.rejects(
      () => readStoredAssetRange(COURSE, assetId, 0, 0, root),
      (error: unknown) => error instanceof CourseMediaError && error.status === 500 && error.message === "Invalid stored media.",
    );
  } finally {
    process.env = environment;
    await rm(root, { recursive: true, force: true });
  }
});

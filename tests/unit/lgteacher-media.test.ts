import assert from "node:assert/strict";
import { test } from "node:test";
import { COURSE_MEDIA_MAX_BYTES } from "../../contracts/lesson-content";
import { CourseMediaError, parseMediaRange, readCourseMediaUpload, validateCourseMediaFile } from "../../services/courseMedia";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1cAAAAASUVORK5CYII=", "base64");
const obj = Buffer.from("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");

test("LGTeacher: small local image and self-contained OBJ fixtures pass real file validation", () => {
  assert.equal(validateCourseMediaFile({ name: "fixture.png", type: "image/png", bytes: png }).size, png.length);
  assert.equal(validateCourseMediaFile({ name: "triangle.obj", type: "model/obj", bytes: obj }).fileType, "model3d");
});

test("LGTeacher: MIME mismatches, renamed scripts, path filenames and external OBJ materials fail", () => {
  for (const input of [
    { name: "fake.png", type: "image/png", bytes: Buffer.from('<script>alert("xss")</script>') },
    { name: "image.png", type: "text/html", bytes: png },
    { name: "../image.png", type: "image/png", bytes: png },
    { name: "folder\\image.png", type: "image/png", bytes: png },
    { name: "image.svg", type: "image/svg+xml", bytes: Buffer.from('<svg onload="alert(1)"/>') },
    { name: "remote.obj", type: "model/obj", bytes: Buffer.concat([obj, Buffer.from("mtllib https://other.test/material.mtl\n")]) },
    { name: "broken.obj", type: "model/obj", bytes: Buffer.from("v 0 0 0\nf 1 2 3\n") },
  ]) assert.throws(() => validateCourseMediaFile(input), CourseMediaError, input.name);
});

test("LGTeacher: multipart parser rejects oversize declarations before reading large fixture data", async () => {
  assert.equal(COURSE_MEDIA_MAX_BYTES, 25 * 1024 * 1024);
  const request = new Request("http://127.0.0.1:3016/upload", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=fixture", "content-length": String(COURSE_MEDIA_MAX_BYTES + 65537) }, body: "small local fixture" });
  await assert.rejects(readCourseMediaUpload(request), error => error instanceof CourseMediaError && error.status === 413);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "fixture.png");
  form.append("usage", "content-image");
  const result = await readCourseMediaUpload(new Request("http://127.0.0.1:3016/upload", { method: "POST", body: form }));
  assert.deepEqual(result.file.bytes, png);
  assert.equal(result.usage, "content-image");
  form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "duplicate.png");
  await assert.rejects(readCourseMediaUpload(new Request("http://127.0.0.1:3016/upload", { method: "POST", body: form })), CourseMediaError);
});

test("LGTeacher: HTTP byte ranges support media seeking and reject invalid ranges", () => {
  assert.equal(parseMediaRange(null, 100), null);
  assert.deepEqual(parseMediaRange("bytes=0-9", 100), { start: 0, end: 9 });
  assert.deepEqual(parseMediaRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseMediaRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseMediaRange("bytes=0-999", 100), { start: 0, end: 99 });
  for (const range of ["bytes=100-", "bytes=5-4", "bytes=-0", "bytes=", "bytes=0-1,3-4", "items=0-9", "bytes=9007199254740992-"]) assert.equal(parseMediaRange(range, 100), "invalid", range);
});

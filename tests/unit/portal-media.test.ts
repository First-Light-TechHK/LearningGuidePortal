import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let media: typeof import("../../services/portalMedia");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-portal-media-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  media = await import("../../services/portalMedia");
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) {
    await rm(isolatedCwd, { recursive: true, force: true });
  }
});

test("sniffImage accepts jpeg png and webp only", () => {
  assert.equal(media.sniffImage(PNG), "image/png");
  assert.equal(media.sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(media.sniffImage(Buffer.from("RIFF....WEBP")), "image/webp");
  assert.equal(media.sniffImage(Buffer.from("GIF89a")), null);
});

test("uploaded portal images are listed in the shared library", async () => {
  const saved = await media.savePortalMedia("hero.png", PNG);
  assert.match(saved.id, /^media_[a-f0-9]{16}$/);
  assert.equal(saved.url, `/api/portal-media/${saved.id}`);
  assert.equal(saved.contentType, "image/png");
  const listed = await media.listPortalLibrary();
  assert.ok(listed.some((item) => item.url === "/portal/auth-library.jpg" && item.kind === "bundled"));
  const uploaded = listed.find((item) => item.id === saved.id);
  assert.equal(uploaded?.kind, "uploaded");
  const file = await media.getPortalMedia(saved.id);
  assert.ok(file);
  assert.equal(file.contentType, "image/png");
  assert.deepEqual(file.buffer, PNG);
});

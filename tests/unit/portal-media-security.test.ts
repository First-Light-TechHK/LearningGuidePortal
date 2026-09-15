import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import sharp from "sharp";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const originalCwd = process.cwd(), previousBackend = process.env.STORAGE_BACKEND;
let directory: string, root: string;
let media: typeof import("../../services/portalMedia");
let files: typeof import("../../services/fileStore");
let images: Record<string, Buffer>;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lg-portal-media-security-"));
  process.chdir(directory); process.env.STORAGE_BACKEND = "local";
  media = await import("../../services/portalMedia");
  files = await import("../../services/fileStore");
  root = path.join(files.SYSTEM_ROOT, "learning_guide", "portal_media");
  images = {};
  for (const format of ["png", "jpeg", "webp"] as const) images[format] = await sharp({ create: { width: 3, height: 2, channels: 3, background: { r: 23, g: 102, b: 185 } } }).toFormat(format).toBuffer();
});

after(async () => {
  process.chdir(originalCwd);
  if (previousBackend === undefined) delete process.env.STORAGE_BACKEND; else process.env.STORAGE_BACKEND = previousBackend;
  await rm(directory, { recursive: true, force: true });
});

test("real PNG, JPEG and WebP fixtures fully decode and survive storage", async () => {
  for (const [format, bytes] of Object.entries(images)) {
    const asset = await media.savePortalMedia(`fixture.${format}`, bytes);
    assert.equal(asset.contentType, `image/${format}`);
    const stored = await media.getPortalMedia(asset.id);
    assert.ok(stored);
    assert.deepEqual(stored.buffer, bytes);
    const decoded = await sharp(stored.buffer).raw().toBuffer({ resolveWithObject: true });
    assert.equal(decoded.info.width, 3); assert.equal(decoded.info.height, 2);
    assert.ok((await media.listPortalLibrary()).some(item => item.id === asset.id));
  }
});

test("spoofed signatures and truncated real images are rejected before any write", async () => {
  const before = await readdir(root);
  for (const buffer of [Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("RIFF....WEBP"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("<svg onload='alert(1)'/>"), ...Object.values(images).map(bytes => bytes.subarray(0, Math.floor(bytes.length / 2)))]) {
    await assert.rejects(media.savePortalMedia("fake.png", buffer));
  }
  assert.deepEqual(await readdir(root), before);
});

test("compressed oversized images and byte oversize uploads are rejected", async () => {
  const oversized = await sharp({ create: { width: 4001, height: 4000, channels: 3, background: "white" } }).png().toBuffer();
  assert.ok(oversized.length < media.PORTAL_MEDIA_MAX_BYTES);
  await assert.rejects(media.savePortalMedia("too-many-pixels.png", oversized), /16 megapixels/);
  await assert.rejects(media.savePortalMedia("too-large.jpg", Buffer.alloc(media.PORTAL_MEDIA_MAX_BYTES + 1)), /5 MB/);
});

test("independent upload processes cannot overwrite each other's library entries", async () => {
  const modulePath = require.resolve("../../services/portalMedia");
  const register = require.resolve("../../scripts/register-tsconfig-paths.cjs");
  const loader = require.resolve("tsx");
  const code = `const {savePortalMedia}=require(${JSON.stringify(modulePath)}); (async()=>{const bytes=Buffer.from(process.env.IMAGE_FIXTURE,"base64");const assets=[];for(let i=0;i<3;i++)assets.push(await savePortalMedia("parallel.png",bytes));console.log(JSON.stringify(assets));})().catch(error=>{console.error(error);process.exitCode=1;});`;
  const results = await Promise.all(Array.from({ length: 3 }, () => run(process.execPath, ["--import", loader, "--require", register, "-e", code], { cwd: directory, env: { ...process.env, STORAGE_BACKEND: "local", IMAGE_FIXTURE: images.png.toString("base64") }, timeout: 20_000 })));
  const ids: string[] = results.flatMap(result => JSON.parse(result.stdout).map((asset: { id: string }) => asset.id));
  assert.equal(new Set(ids).size, 9);
  const listed = await media.listPortalMedia();
  for (const id of ids) {
    assert.ok(listed.some(asset => asset.id === id));
    assert.ok(await media.getPortalMedia(id));
    assert.ok((await readdir(root)).includes(`${id}.json`));
  }
  assert.equal((await readdir(root)).includes("index.json"), false);
});

test("legacy indexed uploads remain listed and readable without rewriting the old index", async () => {
  const id = "media_0123456789abcdef";
  const asset = { id, fileName: "legacy.png", contentType: "image/png", byteSize: images.png.length, createdAt: new Date(0).toISOString(), url: `/api/portal-media/${id}` };
  const index = path.join(root, "index.json");
  await files.writeBinary(path.join(root, `${id}.bin`), images.png);
  await files.atomicWriteJson(index, [asset]);
  const original = await readFile(index, "utf8");
  const added = await media.savePortalMedia("new.png", images.png);
  assert.equal(await readFile(index, "utf8"), original);
  const library = await media.listPortalLibrary();
  assert.ok(library.some(item => item.id === id));
  assert.ok(library.some(item => item.id === added.id));
  assert.ok(library.some(item => item.kind === "bundled"));
  assert.deepEqual((await media.getPortalMedia(id))?.buffer, images.png);
});

test("corrupt legacy metadata cannot be silently replaced and new asset reads remain independent", async () => {
  const current = await media.savePortalMedia("independent.png", images.png);
  const index = path.join(root, "index.json");
  await files.writeText(index, "{broken json");
  await assert.rejects(media.listPortalMedia());
  const added = await media.savePortalMedia("new-independent.png", images.png);
  assert.ok(await media.getPortalMedia(current.id));
  assert.ok(await media.getPortalMedia(added.id));
  assert.equal((await readFile(index, "utf8")).trim(), "{broken json");
  await files.atomicWriteJson(index, []);
});

test("historical fake-image uploads are withheld and asset paths cannot escape storage", async () => {
  const id = "media_fedcba9876543210", bytes = Buffer.from([0xff, 0xd8, 0xff]);
  await files.writeBinary(path.join(root, `${id}.bin`), bytes);
  await files.atomicWriteJson(path.join(root, "index.json"), [{ id, fileName: "old.jpg", contentType: "image/jpeg", byteSize: bytes.length, createdAt: new Date(0).toISOString(), url: `/api/portal-media/${id}` }]);
  assert.equal(await media.getPortalMedia(id), null);
  assert.equal(await media.getPortalMedia("../index.json"), null);
  assert.equal(await media.getPortalMedia("media_0000000000000000"), null);
});

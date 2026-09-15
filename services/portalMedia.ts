import { randomBytes } from "crypto";
import path from "path";
import { bundledPortalImages } from "@/lib/portalContent";
import type { PortalLibraryItem } from "@/lib/portalLibrary";
import { ensureDir, readBinary, readJson, SYSTEM_ROOT, writeBinary, atomicWriteJson } from "./fileStore";

export type { PortalLibraryItem };

export const PORTAL_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
const MEDIA_ID = /^media_[a-f0-9]{16}$/;
const ROOT = path.join(SYSTEM_ROOT, "learning_guide", "portal_media");
const INDEX = path.join(ROOT, "index.json");

export type PortalMediaType = "image/jpeg" | "image/png" | "image/webp";
export type PortalMediaAsset = {
  id: string;
  fileName: string;
  contentType: PortalMediaType;
  byteSize: number;
  createdAt: string;
  url: string;
};

let queue = Promise.resolve();

function withIndex<T>(fn: (items: PortalMediaAsset[]) => T | Promise<T>) {
  const run = queue.then(async () => {
    await ensureDir(ROOT);
    const items = await readJson<PortalMediaAsset[]>(INDEX, []);
    const result = await fn(items);
    await atomicWriteJson(INDEX, items);
    return result;
  });
  queue = run.then(() => undefined, () => undefined);
  return run;
}

export function sniffImage(buffer: Buffer): PortalMediaType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export function isPortalMediaId(value: string) {
  return MEDIA_ID.test(value);
}

function extensionFor(contentType: PortalMediaType) {
  return contentType === "image/jpeg" ? "jpg" : contentType === "image/png" ? "png" : "webp";
}

function sanitizeFileName(fileName: string, contentType: PortalMediaType) {
  const base = fileName.replace(/[/\\]/g, "").replace(/[^\w.\- ()]/g, "").trim().slice(0, 80);
  const fallback = `banner.${extensionFor(contentType)}`;
  return base || fallback;
}

function filePath(id: string) {
  return path.join(ROOT, `${id}.bin`);
}

export async function savePortalMedia(fileName: string, buffer: Buffer): Promise<PortalMediaAsset> {
  if (buffer.length === 0 || buffer.length > PORTAL_MEDIA_MAX_BYTES) throw new Error("The image must be 5 MB or smaller.");
  const contentType = sniffImage(buffer);
  if (!contentType) throw new Error("Use a JPG, PNG or WebP image.");
  const id = `media_${randomBytes(8).toString("hex")}`;
  const asset: PortalMediaAsset = {
    id,
    fileName: sanitizeFileName(fileName, contentType),
    contentType,
    byteSize: buffer.length,
    createdAt: new Date().toISOString(),
    url: `/api/portal-media/${id}`
  };
  await ensureDir(ROOT);
  await writeBinary(filePath(id), buffer);
  await withIndex((items) => {
    items.unshift(asset);
    return asset;
  });
  return asset;
}

export async function listPortalMedia() {
  await ensureDir(ROOT);
  return readJson<PortalMediaAsset[]>(INDEX, []);
}

export async function listPortalLibrary(): Promise<PortalLibraryItem[]> {
  const uploaded = await listPortalMedia();
  const bundled = bundledPortalImages().map((url) => ({
    id: `bundled:${url}`,
    fileName: url.split("/").pop() || url,
    url,
    kind: "bundled" as const
  }));
  return [...uploaded.map((item) => ({ ...item, kind: "uploaded" as const })), ...bundled];
}

export async function getPortalMedia(id: string) {
  if (!isPortalMediaId(id)) return null;
  const items = await listPortalMedia();
  const asset = items.find((item) => item.id === id);
  if (!asset) return null;
  try {
    return { buffer: await readBinary(filePath(id)), contentType: asset.contentType };
  } catch {
    return null;
  }
}

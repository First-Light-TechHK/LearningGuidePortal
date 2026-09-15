import { randomBytes } from "crypto";
import path from "path";
import sharp from "sharp";
import { bundledPortalImages } from "@/lib/portalContent";
import type { PortalLibraryItem } from "@/lib/portalLibrary";
import { ensureDir, readBinary, readText, listDir, SYSTEM_ROOT, writeBinary, atomicWriteJson } from "./fileStore";

export type { PortalLibraryItem };

export const PORTAL_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const PORTAL_MEDIA_MAX_PIXELS = 16_000_000;
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

// Identification only. Upload acceptance also requires a complete bounded decode.
export function sniffImage(buffer: Buffer): PortalMediaType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
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

async function validateImage(buffer: Buffer): Promise<PortalMediaType> {
  if (buffer.length === 0 || buffer.length > PORTAL_MEDIA_MAX_BYTES) throw new Error("The image must be 5 MB or smaller.");
  const contentType = sniffImage(buffer);
  if (!contentType) throw new Error("Use a JPG, PNG or WebP image.");
  try {
    const image = sharp(buffer, { failOn: "warning", limitInputPixels: PORTAL_MEDIA_MAX_PIXELS, animated: true });
    const metadata = await image.metadata();
    const expected = contentType === "image/jpeg" ? "jpeg" : contentType === "image/png" ? "png" : "webp";
    if (metadata.format !== expected || !metadata.width || !metadata.height || metadata.width * metadata.height > PORTAL_MEDIA_MAX_PIXELS || (metadata.pages || 1) !== 1) throw new Error("Unsupported image dimensions or animation.");
    // metadata() alone accepts truncated files; force decoding of every pixel.
    await image.raw().toBuffer();
  } catch { throw new Error("Use a complete, static JPG, PNG or WebP image of at most 16 megapixels."); }
  return contentType;
}

function mediaAsset(value: unknown): PortalMediaAsset {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid portal media metadata.");
  const asset = value as PortalMediaAsset;
  if (!isPortalMediaId(asset.id) || !["image/jpeg", "image/png", "image/webp"].includes(asset.contentType) || !Number.isSafeInteger(asset.byteSize) || asset.byteSize < 1 || asset.byteSize > PORTAL_MEDIA_MAX_BYTES || typeof asset.fileName !== "string" || asset.fileName.length > 255 || typeof asset.createdAt !== "string" || !Number.isFinite(Date.parse(asset.createdAt)) || asset.url !== `/api/portal-media/${asset.id}`) throw new Error("Invalid portal media metadata.");
  return asset;
}

async function readMetadata(file: string): Promise<unknown | null> {
  try { return JSON.parse(await readText(file)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function legacyMedia(): Promise<PortalMediaAsset[]> {
  const value = await readMetadata(INDEX);
  if (value === null) return [];
  if (!Array.isArray(value)) throw new Error("Invalid portal media index.");
  return value.map(mediaAsset);
}

export async function savePortalMedia(fileName: string, buffer: Buffer): Promise<PortalMediaAsset> {
  const contentType = await validateImage(buffer);
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
  // Publish one immutable metadata record only after its binary is fully stored.
  // No shared read/modify/write index, including across App Runner instances.
  await atomicWriteJson(path.join(ROOT, `${id}.json`), asset);
  return asset;
}

export async function listPortalMedia() {
  await ensureDir(ROOT);
  const items = new Map((await legacyMedia()).map(asset => [asset.id, asset]));
  for (const file of await listDir(ROOT)) {
    if (!/^media_[a-f0-9]{16}\.json$/.test(file)) continue;
    const asset = mediaAsset(await readMetadata(path.join(ROOT, file)));
    if (file !== `${asset.id}.json`) throw new Error("Invalid portal media metadata.");
    items.set(asset.id, asset);
  }
  return [...items.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
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
  const metadata = await readMetadata(path.join(ROOT, `${id}.json`));
  const asset = metadata === null ? (await legacyMedia()).find(item => item.id === id) : mediaAsset(metadata);
  if (!asset) return null;
  if (asset.id !== id) throw new Error("Invalid portal media metadata.");
  try {
    const buffer = await readBinary(filePath(id));
    if (buffer.length !== asset.byteSize || sniffImage(buffer) !== asset.contentType) return null;
    if (metadata === null) {
      try { if (await validateImage(buffer) !== asset.contentType) return null; } catch { return null; }
    }
    return { buffer, contentType: asset.contentType };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

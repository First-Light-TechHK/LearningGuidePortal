import path from "path";
import crypto from "crypto";
import {
  vfsExists,
  vfsMkdir,
  vfsReadBuffer,
  vfsReadJson,
  vfsReadText,
  vfsReaddir,
  vfsRemove,
  vfsStat,
  vfsWriteBuffer,
  vfsWriteJson,
  vfsWriteText
} from "./persistence/vfs";

export const SYSTEM_ROOT = path.join(process.cwd(), "data", "knowledge_system");
export const COURSES_ROOT = path.join(SYSTEM_ROOT, "courses");

export function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `item-${crypto.randomBytes(4).toString("hex")}`;
}

export function safeSegment(value: string) {
  const segment = slugify(value);
  if (!segment || segment.includes("..") || segment.includes("/") || segment.includes("\\")) {
    throw new Error("Invalid path segment");
  }
  return segment;
}

export function ensureInside(root: string, target: string) {
  const resolved = path.resolve(target);
  const base = path.resolve(root);
  if (!resolved.startsWith(base)) throw new Error("Invalid path");
  return resolved;
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  return vfsReadJson(SYSTEM_ROOT, file, fallback);
}

export async function atomicWriteJson(file: string, data: unknown) {
  await vfsWriteJson(SYSTEM_ROOT, file, data);
}

export async function removeDir(target: string) {
  await vfsRemove(SYSTEM_ROOT, target);
}

export async function readText(file: string) {
  return vfsReadText(SYSTEM_ROOT, file);
}

export async function writeText(file: string, text: string) {
  await vfsWriteText(SYSTEM_ROOT, file, text);
}

export async function readBinary(file: string) {
  return vfsReadBuffer(SYSTEM_ROOT, file);
}

export async function writeBinary(file: string, buffer: Buffer) {
  await vfsWriteBuffer(SYSTEM_ROOT, file, buffer);
}

export async function pathExists(file: string) {
  return vfsExists(SYSTEM_ROOT, file);
}

export async function pathStat(file: string) {
  return vfsStat(SYSTEM_ROOT, file);
}

export async function listDir(dir: string) {
  return vfsReaddir(SYSTEM_ROOT, dir);
}

export async function ensureDir(dir: string) {
  await vfsMkdir(SYSTEM_ROOT, dir);
}

export function now() {
  return new Date().toISOString();
}

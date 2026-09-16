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

export function systemRoot() {
  return path.join(process.cwd(), "data", "knowledge_system");
}

export function coursesRoot() {
  return path.join(systemRoot(), "courses");
}

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
  return vfsReadJson(systemRoot(), file, fallback);
}

export async function atomicWriteJson(file: string, data: unknown) {
  await vfsWriteJson(systemRoot(), file, data);
}

export async function removeDir(target: string) {
  await vfsRemove(systemRoot(), target);
}

export async function readText(file: string) {
  return vfsReadText(systemRoot(), file);
}

export async function writeText(file: string, text: string) {
  await vfsWriteText(systemRoot(), file, text);
}

export async function readBinary(file: string) {
  return vfsReadBuffer(systemRoot(), file);
}

export async function writeBinary(file: string, buffer: Buffer) {
  await vfsWriteBuffer(systemRoot(), file, buffer);
}

export async function pathExists(file: string) {
  return vfsExists(systemRoot(), file);
}

export async function pathStat(file: string) {
  return vfsStat(systemRoot(), file);
}

export async function listDir(dir: string) {
  return vfsReaddir(systemRoot(), dir);
}

export async function ensureDir(dir: string) {
  await vfsMkdir(systemRoot(), dir);
}

export function now() {
  return new Date().toISOString();
}

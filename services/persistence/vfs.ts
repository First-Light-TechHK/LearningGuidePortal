import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { persistenceEnabled } from "./config";
import { query } from "./db";
import { s3DeleteMany, s3Get, s3Put } from "./s3";

const TEXT_DB_MAX_BYTES = 512 * 1024;
const BINARY_EXT = new Set([".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg", ".gif", ".zip", ".bin"]);

export type VfsStat = { size: number; birthtime: Date; mtime: Date; isFile: () => boolean };

function isUnderRoot(root: string, target: string) {
  const resolved = path.resolve(target);
  const base = path.resolve(root);
  return resolved === base || resolved.startsWith(`${base}${path.sep}`);
}

export function toRelativeDataPath(systemRoot: string, absolutePath: string) {
  const resolved = path.resolve(absolutePath);
  const root = path.resolve(systemRoot);
  if (!isUnderRoot(root, resolved)) {
    throw new Error(`Path escapes data root: ${absolutePath}`);
  }
  return path.relative(root, resolved).split(path.sep).join("/");
}

function guessContentType(relativePath: string, asBinary: boolean) {
  const ext = path.extname(relativePath).toLowerCase();
  if (ext === ".json") return "application/json";
  if (ext === ".md") return "text/markdown";
  if (ext === ".txt") return "text/plain";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return asBinary ? "application/octet-stream" : "text/plain; charset=utf-8";
}

function shouldUseS3(relativePath: string, bytes: Buffer) {
  const ext = path.extname(relativePath).toLowerCase();
  if (BINARY_EXT.has(ext)) return true;
  if (relativePath.includes("/source_materials/files/") || relativePath.includes("/source_materials/qa_notes/")) return true;
  return bytes.byteLength > TEXT_DB_MAX_BYTES;
}

async function localWriteFile(file: string, data: string | Buffer) {
  await mkdir(path.dirname(file), { recursive: true });
  if (typeof data === "string") {
    const tmp = `${file}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, data, "utf8");
    await rename(tmp, file);
    return;
  }
  await writeFile(file, data);
}

export async function vfsWriteText(systemRoot: string, absolutePath: string, text: string) {
  if (!persistenceEnabled()) {
    await localWriteFile(absolutePath, `${text.endsWith("\n") ? text : `${text}\n`}`);
    return;
  }
  const relativePath = toRelativeDataPath(systemRoot, absolutePath);
  const body = Buffer.from(text, "utf8");
  const contentType = guessContentType(relativePath, false);
  if (shouldUseS3(relativePath, body)) {
    const s3Key = await s3Put(relativePath, body, contentType);
    await query(
      `INSERT INTO app_files(path, storage, content, s3_key, byte_size, content_type, updated_at)
       VALUES ($1, 's3', NULL, $2, $3, $4, NOW())
       ON CONFLICT (path) DO UPDATE SET
         storage = EXCLUDED.storage,
         content = NULL,
         s3_key = EXCLUDED.s3_key,
         byte_size = EXCLUDED.byte_size,
         content_type = EXCLUDED.content_type,
         updated_at = NOW()`,
      [relativePath, s3Key, body.byteLength, contentType]
    );
    return;
  }
  await query(
    `INSERT INTO app_files(path, storage, content, s3_key, byte_size, content_type, updated_at)
     VALUES ($1, 'db', $2, NULL, $3, $4, NOW())
     ON CONFLICT (path) DO UPDATE SET
       storage = 'db',
       content = EXCLUDED.content,
       s3_key = NULL,
       byte_size = EXCLUDED.byte_size,
       content_type = EXCLUDED.content_type,
       updated_at = NOW()`,
    [relativePath, text, body.byteLength, contentType]
  );
}

export async function vfsWriteBuffer(systemRoot: string, absolutePath: string, buffer: Buffer) {
  if (!persistenceEnabled()) {
    await localWriteFile(absolutePath, buffer);
    return;
  }
  const relativePath = toRelativeDataPath(systemRoot, absolutePath);
  const contentType = guessContentType(relativePath, true);
  const s3Key = await s3Put(relativePath, buffer, contentType);
  await query(
    `INSERT INTO app_files(path, storage, content, s3_key, byte_size, content_type, updated_at)
     VALUES ($1, 's3', NULL, $2, $3, $4, NOW())
     ON CONFLICT (path) DO UPDATE SET
       storage = 's3',
       content = NULL,
       s3_key = EXCLUDED.s3_key,
       byte_size = EXCLUDED.byte_size,
       content_type = EXCLUDED.content_type,
       updated_at = NOW()`,
    [relativePath, s3Key, buffer.byteLength, contentType]
  );
}

export async function vfsReadText(systemRoot: string, absolutePath: string) {
  if (!persistenceEnabled()) {
    return readFile(absolutePath, "utf8");
  }
  const relativePath = toRelativeDataPath(systemRoot, absolutePath);
  const result = await query<{ storage: string; content: string | null; s3_key: string | null }>(
    `SELECT storage, content, s3_key FROM app_files WHERE path = $1`,
    [relativePath]
  );
  const row = result.rows[0];
  if (!row) {
    const error = new Error(`ENOENT: ${relativePath}`) as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  }
  if (row.storage === "db") return row.content || "";
  if (!row.s3_key) throw new Error(`Missing s3_key for ${relativePath}`);
  return (await s3Get(row.s3_key)).toString("utf8");
}

export async function vfsReadBuffer(systemRoot: string, absolutePath: string) {
  if (!persistenceEnabled()) {
    return readFile(absolutePath);
  }
  const relativePath = toRelativeDataPath(systemRoot, absolutePath);
  const result = await query<{ storage: string; content: string | null; s3_key: string | null }>(
    `SELECT storage, content, s3_key FROM app_files WHERE path = $1`,
    [relativePath]
  );
  const row = result.rows[0];
  if (!row) {
    const error = new Error(`ENOENT: ${relativePath}`) as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  }
  if (row.storage === "db") return Buffer.from(row.content || "", "utf8");
  if (!row.s3_key) throw new Error(`Missing s3_key for ${relativePath}`);
  return s3Get(row.s3_key);
}

export async function vfsExists(systemRoot: string, absolutePath: string) {
  if (!persistenceEnabled()) {
    try {
      await stat(absolutePath);
      return true;
    } catch {
      return false;
    }
  }
  const relativePath = toRelativeDataPath(systemRoot, absolutePath);
  const result = await query(`SELECT 1 FROM app_files WHERE path = $1 LIMIT 1`, [relativePath]);
  return result.rowCount !== null && result.rowCount > 0;
}

export async function vfsStat(systemRoot: string, absolutePath: string): Promise<VfsStat> {
  if (!persistenceEnabled()) {
    const info = await stat(absolutePath);
    return {
      size: info.size,
      birthtime: info.birthtime,
      mtime: info.mtime,
      isFile: () => info.isFile()
    };
  }
  const relativePath = toRelativeDataPath(systemRoot, absolutePath);
  const result = await query<{ byte_size: number; updated_at: Date }>(
    `SELECT byte_size, updated_at FROM app_files WHERE path = $1`,
    [relativePath]
  );
  const row = result.rows[0];
  if (!row) {
    const error = new Error(`ENOENT: ${relativePath}`) as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  }
  const when = new Date(row.updated_at);
  return {
    size: row.byte_size,
    birthtime: when,
    mtime: when,
    isFile: () => true
  };
}

export async function vfsRemove(systemRoot: string, absolutePath: string) {
  if (!persistenceEnabled()) {
    await rm(absolutePath, { force: true, recursive: true });
    return;
  }
  const relativePath = toRelativeDataPath(systemRoot, absolutePath);
  const listed = await query<{ storage: string; s3_key: string | null }>(
    `SELECT storage, s3_key FROM app_files WHERE path = $1 OR path LIKE $2`,
    [relativePath, `${relativePath}/%`]
  );
  const s3Keys = listed.rows.filter((row) => row.storage === "s3" && row.s3_key).map((row) => row.s3_key as string);
  await s3DeleteMany(s3Keys);
  await query(`DELETE FROM app_files WHERE path = $1 OR path LIKE $2`, [relativePath, `${relativePath}/%`]);
}

export async function vfsMkdir(_systemRoot: string, _absolutePath: string) {
  if (!persistenceEnabled()) {
    await mkdir(_absolutePath, { recursive: true });
  }
}

export async function vfsReaddir(systemRoot: string, absolutePath: string) {
  if (!persistenceEnabled()) {
    return readdir(absolutePath);
  }
  const relativePath = toRelativeDataPath(systemRoot, absolutePath);
  const prefix = relativePath ? `${relativePath}/` : "";
  const result = await query<{ path: string }>(
    relativePath
      ? `SELECT path FROM app_files WHERE path LIKE $1`
      : `SELECT path FROM app_files`,
    relativePath ? [`${prefix}%`] : []
  );
  const names = new Set<string>();
  for (const row of result.rows) {
    const rest = relativePath ? row.path.slice(prefix.length) : row.path;
    if (!rest) continue;
    names.add(rest.split("/")[0]);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export async function vfsReadJson<T>(systemRoot: string, absolutePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await vfsReadText(systemRoot, absolutePath)) as T;
  } catch {
    return fallback;
  }
}

export async function vfsWriteJson(systemRoot: string, absolutePath: string, data: unknown) {
  await vfsWriteText(systemRoot, absolutePath, `${JSON.stringify(data, null, 2)}\n`);
}

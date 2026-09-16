import { randomUUID } from "node:crypto";
import path from "node:path";
import { COURSE_MEDIA_MAX_BYTES, type CourseMediaAsset } from "@/contracts/lesson-content";
import { systemRoot } from "@/services/fileStore";
import { vfsReadBuffer, vfsWriteBuffer } from "@/services/persistence/vfs";
import { persistenceEnabled } from "@/services/persistence/config";
import { isManagedEnvironment } from "@/services/runtimeConfig";
import { canManageCourse } from "@/services/backofficeAccess";
import { requestOriginMatches } from "@/services/adminHost";
import { checkEntitlement, getProductCourse, publicFirstLesson, type ProductCourse, type ProductUser } from "@/services/productStore";
import { courseMediaAssetId, isContentId, lessonContentAssetIds, lessonContentAssetReferences } from "@/services/lessonContent";

export { COURSE_MEDIA_MAX_BYTES } from "@/contracts/lesson-content";

export class CourseMediaError extends Error {
  constructor(public code: "invalid" | "restricted" | "notFound" | "tooLarge" | "unsupported" | "failed", public status: number, message: string) { super(message); }
}

type Format = { fileType: CourseMediaAsset["fileType"]; mimeType: string; accepted: string[] };
const format = (fileType: Format["fileType"], mimeType: string, ...accepted: string[]): Format => ({ fileType, mimeType, accepted: [mimeType, ...accepted] });
const FORMATS: Record<string, Format> = {
  jpg: format("image", "image/jpeg"), jpeg: format("image", "image/jpeg"),
  png: format("image", "image/png"), gif: format("image", "image/gif"), webp: format("image", "image/webp"),
  pdf: format("pdf", "application/pdf"),
  mp4: format("video", "video/mp4"), mov: format("video", "video/quicktime"), webm: format("video", "video/webm"),
  mp3: format("audio", "audio/mpeg", "audio/mp3"), wav: format("audio", "audio/wav", "audio/wave", "audio/x-wav"),
  ogg: format("audio", "audio/ogg", "application/ogg"), oga: format("audio", "audio/ogg", "application/ogg"),
  m4a: format("audio", "audio/mp4", "audio/x-m4a"), flac: format("audio", "audio/flac", "audio/x-flac"),
  obj: format("model3d", "model/obj", "text/plain", "application/octet-stream"),
  glb: format("model3d", "model/gltf-binary", "application/octet-stream"),
};

function validObj(bytes: Buffer): boolean {
  let source: string;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return false; }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(source)) return false;
  const counts = [0, 0, 0];
  let faces = 0;
  for (const line of source.split(/\r?\n/)) {
    const parts = line.split("#", 1)[0].trim().split(/\s+/);
    const kind = parts.shift();
    if (!kind) continue;
    if (["v", "vt", "vn"].includes(kind)) {
      const index = kind === "v" ? 0 : kind === "vt" ? 1 : 2;
      if (parts.length < (kind === "vt" ? 1 : 3) || parts.length > (kind === "v" ? 4 : 3) || parts.some(value => !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 1e9)) return false;
      counts[index]++;
    } else if (kind === "f") {
      if (parts.length < 3 || parts.length > 1000) return false;
      for (const face of parts) {
        if (!/^-?\d+(?:\/(?:-?\d+)?(?:\/-?\d+)?)?$/.test(face)) return false;
        const indices = face.split("/");
        if (indices.some((value, index) => value !== "" && (!Number.isSafeInteger(Number(value)) || Number(value) === 0 || Math.abs(Number(value)) > counts[index]))) return false;
      }
      faces++;
    } else if (!["o", "g", "s"].includes(kind) || parts.join(" ").length > 255 || /[<>\\/:]/.test(parts.join(" "))) {
      // Material files and external textures are deliberately unsupported.
      return false;
    }
  }
  return counts[0] >= 3 && faces > 0;
}

function validGlb(bytes: Buffer): boolean {
  if (bytes.length < 24 || bytes.toString("ascii", 0, 4) !== "glTF" || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) return false;
  let offset = 12;
  let document: Record<string, unknown> | undefined;
  let binaryLength = 0;
  while (offset + 8 <= bytes.length) {
    const size = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    if (size % 4 || size === 0 || offset + 8 + size > bytes.length) return false;
    if (offset === 12 && type === 0x4e4f534a) {
      if (size > 2 * 1024 * 1024) return false;
      try { document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset + 8, offset + 8 + size))); } catch { return false; }
    } else if (type === 0x004e4942 && !binaryLength) binaryLength = size;
    else return false;
    offset += 8 + size;
  }
  if (offset !== bytes.length || !document || typeof document !== "object" || Array.isArray(document)) return false;
  const asset = document.asset as { version?: unknown } | undefined;
  if (asset?.version !== "2.0" || !Array.isArray(document.meshes) || !document.meshes.length || !Array.isArray(document.buffers) || document.buffers.length !== 1) return false;
  const buffer = document.buffers[0] as { byteLength?: unknown } | null;
  if (!buffer || typeof buffer.byteLength !== "number" || !Number.isSafeInteger(buffer.byteLength) || buffer.byteLength <= 0 || buffer.byteLength > binaryLength || binaryLength - buffer.byteLength > 3) return false;
  const stack: unknown[] = [document];
  let objects = 0;
  while (stack.length) {
    const item = stack.pop();
    if (item && typeof item === "object") {
      if (++objects > 100_000) return false;
      for (const [key, value] of Object.entries(item)) {
        if (key.toLowerCase() === "uri" || key === "url") return false;
        if (value && typeof value === "object") stack.push(value);
      }
    }
  }
  return true;
}

function validIsoMedia(bytes: Buffer, extension: string): boolean {
  let offset = 0, ftyp = false, media = false, movie = false;
  while (offset + 8 <= bytes.length) {
    let size = bytes.readUInt32BE(offset);
    const box = bytes.toString("ascii", offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > bytes.length) return false;
      const large = bytes.readBigUInt64BE(offset + 8);
      if (large > BigInt(bytes.length)) return false;
      size = Number(large); headerSize = 16;
    } else if (size === 0) size = bytes.length - offset;
    if (size < headerSize || offset + size > bytes.length) return false;
    if (offset === 0) {
      if (box !== "ftyp" || size < 16) return false;
      const brands = bytes.toString("ascii", offset + 8, offset + size);
      if (extension === "mov" ? !brands.includes("qt  ") : !/(isom|iso[2-9]|mp4[12]|avc1|M4A |M4V |dash|MSNV)/.test(brands)) return false;
      ftyp = true;
    }
    if (box === "mdat" && size > headerSize) media = true;
    if (box === "moov" && size > headerSize) movie = true;
    offset += size;
  }
  return offset === bytes.length && ftyp && media && movie;
}

function matchesSignature(bytes: Buffer, extension: string): boolean {
  const starts = (hex: string) => bytes.subarray(0, hex.length / 2).equals(Buffer.from(hex, "hex"));
  if (extension === "jpg" || extension === "jpeg") return bytes.length >= 4 && starts("ffd8ff") && bytes.subarray(-2).equals(Buffer.from("ffd9", "hex"));
  if (extension === "png") return bytes.length >= 45 && starts("89504e470d0a1a0a") && bytes.toString("ascii", 12, 16) === "IHDR" && bytes.toString("ascii", bytes.length - 8, bytes.length - 4) === "IEND";
  if (extension === "gif") return bytes.length >= 14 && /GIF8[79]a/.test(bytes.toString("ascii", 0, 6)) && bytes[bytes.length - 1] === 0x3b;
  if (extension === "webp") return bytes.length >= 20 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.readUInt32LE(4) + 8 === bytes.length && bytes.toString("ascii", 8, 12) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("ascii", 12, 16));
  if (extension === "pdf") return /^%PDF-(1\.[0-7]|2\.0)/.test(bytes.toString("ascii", 0, 8)) && /%%EOF\s*$/.test(bytes.subarray(-1024).toString("ascii"));
  if (["mp4", "mov", "m4a"].includes(extension)) return validIsoMedia(bytes, extension);
  if (extension === "webm") return starts("1a45dfa3") && bytes.subarray(0, 4096).includes(Buffer.from("webm")) && bytes.includes(Buffer.from("18538067", "hex"));
  if (extension === "wav") return bytes.length >= 44 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.readUInt32LE(4) + 8 === bytes.length && bytes.toString("ascii", 8, 12) === "WAVE" && bytes.includes(Buffer.from("fmt ")) && bytes.includes(Buffer.from("data"));
  if (extension === "ogg" || extension === "oga") return bytes.length >= 35 && bytes.toString("ascii", 0, 4) === "OggS" && bytes[4] === 0 && (bytes.subarray(0, 512).includes(Buffer.from("OpusHead")) || bytes.subarray(0, 512).includes(Buffer.from("\x01vorbis")));
  if (extension === "flac") return bytes.length >= 42 && bytes.toString("ascii", 0, 4) === "fLaC" && (bytes[4] & 0x7f) === 0 && bytes.readUIntBE(5, 3) === 34;
  if (extension === "mp3") {
    let start = 0;
    if (bytes.toString("ascii", 0, 3) === "ID3") {
      if (bytes.length < 10 || bytes.subarray(6, 10).some(value => value > 127)) return false;
      start = 10 + bytes[6] * 2 ** 21 + bytes[7] * 2 ** 14 + bytes[8] * 128 + bytes[9];
      if (bytes[5] & 0x10) start += 10;
    }
    return bytes.length >= start + 4 && bytes[start] === 0xff && (bytes[start + 1] & 0xe0) === 0xe0 && (bytes[start + 1] & 0x18) !== 0x08 && (bytes[start + 1] & 0x06) !== 0 && (bytes[start + 2] & 0xf0) !== 0xf0 && (bytes[start + 2] & 0xf0) !== 0 && (bytes[start + 2] & 0x0c) !== 0x0c;
  }
  if (extension === "obj") return validObj(bytes);
  if (extension === "glb") return validGlb(bytes);
  return false;
}

export function validateCourseMediaFile(input: { name: string; type: string; bytes: Buffer }): Pick<CourseMediaAsset, "originalName" | "fileType" | "mimeType" | "extension" | "size"> {
  if (!input.bytes.length || input.bytes.length > COURSE_MEDIA_MAX_BYTES) throw new CourseMediaError("tooLarge", 413, "Files must be non-empty and no larger than 25 MiB.");
  if (typeof input.name !== "string" || input.name.length > 255 || /[\u0000-\u001f\u007f/\\]/.test(input.name)) throw new CourseMediaError("invalid", 400, "Invalid filename.");
  const extension = path.extname(input.name).slice(1).toLowerCase();
  const format = FORMATS[extension];
  const mime = input.type.toLowerCase().trim();
  if (!format || (mime && !format.accepted.includes(mime))) throw new CourseMediaError("unsupported", 415, "Unsupported file extension or media type.");
  if (!matchesSignature(input.bytes, extension)) throw new CourseMediaError("unsupported", 415, "File signature or self-contained media structure is invalid.");
  return { originalName: input.name, fileType: format.fileType, mimeType: format.mimeType, extension, size: input.bytes.length };
}

function assetPath(courseId: string, assetId: string): string {
  if (!courseMediaAssetId(`/api/course-media/${courseId}/${assetId}`, courseId)) throw new CourseMediaError("notFound", 404, "Media not found.");
  return path.join(systemRoot(), "course_media", courseId, `${assetId}.bin`);
}

function checkStorage(): void {
  // Production must never silently fall back to an ephemeral App Runner disk.
  if (isManagedEnvironment() && !persistenceEnabled()) throw new CourseMediaError("failed", 503, "Private media storage is not configured.");
}

export async function requireCourseMediaManager(user: ProductUser | null, courseId: string): Promise<ProductCourse> {
  if (!user || user.status !== "active") throw new CourseMediaError("restricted", 403, "Course management access is required.");
  if (!isContentId(courseId)) throw new CourseMediaError("notFound", 404, "Course not found.");
  const course = await getProductCourse(courseId);
  if (!course || course.id !== courseId) throw new CourseMediaError("notFound", 404, "Course not found.");
  if (!canManageCourse(user, course)) throw new CourseMediaError("restricted", 403, "Course management access is required.");
  return course;
}

export async function uploadCourseMedia(user: ProductUser | null, courseId: string, file: { name: string; type: string; bytes: Buffer }, usage?: string): Promise<CourseMediaAsset> {
  await requireCourseMediaManager(user, courseId);
  const metadata = validateCourseMediaFile(file);
  if (usage && (usage === "course-cover" ? metadata.fileType !== "image" : usage !== `content-${metadata.fileType}`)) throw new CourseMediaError("invalid", 400, "File type does not match its intended use.");
  checkStorage();
  const id = randomUUID();
  const asset: CourseMediaAsset = { ...metadata, id, courseId, url: `/api/course-media/${courseId}/${id}`, createdAt: new Date().toISOString() };
  // One private object keeps metadata and bytes together in local and S3 storage.
  const header = Buffer.from(JSON.stringify({ ...asset, uploadedBy: user!.id }));
  const length = Buffer.alloc(4); length.writeUInt32BE(header.length);
  await vfsWriteBuffer(systemRoot(), assetPath(courseId, id), Buffer.concat([length, header, file.bytes]));
  return asset;
}

async function readStoredAsset(courseId: string, assetId: string): Promise<{ asset: CourseMediaAsset; bytes: Buffer }> {
  const file = assetPath(courseId, assetId);
  checkStorage();
  let stored: Buffer;
  try { stored = await vfsReadBuffer(systemRoot(), file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as Error).name === "NoSuchKey") throw new CourseMediaError("notFound", 404, "Media not found.");
    throw error;
  }
  if (stored.length < 5 || stored.length > COURSE_MEDIA_MAX_BYTES + 8196) throw new CourseMediaError("failed", 500, "Invalid stored media.");
  const length = stored.readUInt32BE(0);
  if (length > 8192 || length + 4 >= stored.length) throw new CourseMediaError("failed", 500, "Invalid stored media.");
  let asset: CourseMediaAsset;
  try { asset = JSON.parse(stored.toString("utf8", 4, 4 + length)); } catch { throw new CourseMediaError("failed", 500, "Invalid stored media."); }
  const bytes = stored.subarray(4 + length);
  if (!asset || asset.id !== assetId || asset.courseId !== courseId || asset.url !== `/api/course-media/${courseId}/${assetId}` || asset.size !== bytes.length) throw new CourseMediaError("failed", 500, "Invalid stored media.");
  const actual = validateCourseMediaFile({ name: asset.originalName, type: asset.mimeType, bytes });
  if (actual.fileType !== asset.fileType || actual.extension !== asset.extension) throw new CourseMediaError("failed", 500, "Invalid stored media.");
  return { asset, bytes };
}

function contentsOf(lesson: { id: string }): unknown {
  return (lesson as { contents?: unknown }).contents || [];
}

export async function canReadCourseMedia(user: ProductUser | null, course: ProductCourse, assetId: string, allowAuthor = false): Promise<boolean> {
  if (!courseMediaAssetId(`/api/course-media/${course.id}/${assetId}`, course.id) || (user && user.status !== "active")) return false;
  if (allowAuthor && user && canManageCourse(user, course)) return true;
  if (course.status !== "published") return false;
  if (courseMediaAssetId(course.cover || course.thumbnailPath, course.id) === assetId) {
    return (await readStoredAsset(course.id, assetId)).asset.fileType === "image";
  }
  const preview = publicFirstLesson(course);
  if (preview && lessonContentAssetIds(contentsOf(preview), course.id).has(assetId)) return true;
  if (!user) return false;
  const referenced = course.sections.some(section => section.lessons.some(lesson => lessonContentAssetIds(contentsOf(lesson), course.id).has(assetId)));
  return referenced && (await checkEntitlement(user.id, course.id)).allowed;
}

/** Optional save-time integrity check, after strict validation and course ownership. */
export async function assertLessonMediaReferences(courseId: string, value: unknown): Promise<void> {
  const references = lessonContentAssetReferences(value, courseId, true);
  const assets = new Map<string, CourseMediaAsset>();
  for (const reference of references) {
    if (!assets.has(reference.assetId)) assets.set(reference.assetId, (await readStoredAsset(courseId, reference.assetId)).asset);
    if (reference.fileType && assets.get(reference.assetId)!.fileType !== reference.fileType) throw new CourseMediaError("invalid", 400, "Media type does not match lesson content.");
  }
}

/** Call on the updated aggregate after ownership checks and before committing a draft. */
export async function assertCourseMediaReferences(course: Pick<ProductCourse, "id" | "sections" | "cover" | "thumbnailPath">): Promise<void> {
  const cover = course.cover || course.thumbnailPath;
  if (cover) {
    const assetId = courseMediaAssetId(cover, course.id);
    if (!assetId && /\/api\/course-media/i.test(cover)) throw new CourseMediaError("invalid", 400, "A course cover must belong to this course.");
    if (assetId && (await readStoredAsset(course.id, assetId)).asset.fileType !== "image") throw new CourseMediaError("invalid", 400, "A course cover must be an image.");
  }
  for (const section of course.sections) {
    for (const lesson of section.lessons) await assertLessonMediaReferences(course.id, contentsOf(lesson));
  }
}

export function parseMediaRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size <= 0) return "invalid";
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return "invalid";
  return { start, end: Math.min(end, size - 1) };
}

export async function serveCourseMedia(request: Request, user: ProductUser | null, courseId: string, assetId: string, allowAuthor = false): Promise<Response> {
  assetPath(courseId, assetId);
  const course = await getProductCourse(courseId);
  if (!course || course.id !== courseId || !await canReadCourseMedia(user, course, assetId, allowAuthor)) throw new CourseMediaError("notFound", 404, "Media not found.");
  const { asset, bytes } = await readStoredAsset(courseId, assetId);
  const headers = new Headers({
    "Content-Type": asset.mimeType,
    "Content-Disposition": `inline; filename="${asset.id}.${asset.extension}"`,
    "Cache-Control": "private, no-store",
    "Vary": "Cookie",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    "Accept-Ranges": "bytes",
  });
  // VFS currently reads whole objects. Range responses save transfer to clients,
  // but do not yet reduce S3 read bandwidth or the bounded server memory usage.
  const range = request.method === "HEAD" || request.headers.has("if-range") ? null : parseMediaRange(request.headers.get("range"), bytes.length);
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${bytes.length}`);
    headers.set("Content-Length", "0");
    return new Response(null, { status: 416, headers });
  }
  const body = range ? bytes.subarray(range.start, range.end + 1) : bytes;
  headers.set("Content-Length", String(body.length));
  if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${bytes.length}`);
  return new Response(request.method === "HEAD" ? null : new Uint8Array(body), { status: range ? 206 : 200, headers });
}

export function assertMediaUploadOrigin(request: Request): void {
  if (requestOriginMatches(request)) return;
  throw new CourseMediaError("restricted", 403, "A same-origin request is required.");
}

/** Count streamed bytes before invoking multipart parsing, including chunked requests. */
export async function readCourseMediaUpload(request: Request): Promise<{ file: { name: string; type: string; bytes: Buffer }; usage?: string }> {
  const type = request.headers.get("content-type") || "";
  if (!/^multipart\/form-data\s*;/i.test(type)) throw new CourseMediaError("invalid", 400, "A multipart file upload is required.");
  const limit = COURSE_MEDIA_MAX_BYTES + 64 * 1024;
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new CourseMediaError("tooLarge", 413, "Upload exceeds 25 MiB.");
  if (!request.body) throw new CourseMediaError("invalid", 400, "A file is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new CourseMediaError("tooLarge", 413, "Upload exceeds 25 MiB.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let form: FormData;
  try { form = await new Response(new Uint8Array(Buffer.concat(chunks)), { headers: { "Content-Type": type } }).formData(); }
  catch { throw new CourseMediaError("invalid", 400, "Invalid multipart upload."); }
  if ([...form.keys()].some(key => !["file", "usage"].includes(key)) || form.getAll("file").length !== 1 || form.getAll("usage").length > 1) throw new CourseMediaError("invalid", 400, "Exactly one file is required.");
  const file = form.get("file"), usage = form.get("usage");
  if (!file || typeof file === "string" || (usage !== null && typeof usage !== "string")) throw new CourseMediaError("invalid", 400, "Invalid upload fields.");
  if (!file.size || file.size > COURSE_MEDIA_MAX_BYTES) throw new CourseMediaError("tooLarge", 413, "Files must be non-empty and no larger than 25 MiB.");
  return { file: { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) }, ...(usage ? { usage } : {}) };
}

export function courseMediaErrorResponse(error: unknown, requestId: string): Response {
  const known = error instanceof CourseMediaError;
  return Response.json({ ok: false, code: known ? error.code : "failed", message: known ? error.message : "Media request failed.", requestId }, { status: known ? error.status : 500, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } });
}

// Helpdesk attachment typing (Figma addendum §B): the type is decided from
// the bytes, never from the declared Content-Type. Images and PDF by magic
// bytes, docx/xlsx by their ZIP structure, txt/csv by extension plus clean
// UTF-8 text. HTML and SVG are never accepted, so they are never served.
import { HELPDESK_LIMITS, type HelpdeskAttachmentType } from "@/contracts/helpdesk";
import { sniffImage } from "@/services/portalMedia";

const DOCX: HelpdeskAttachmentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX: HelpdeskAttachmentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const EXTENSIONS: Record<HelpdeskAttachmentType, readonly string[]> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "application/pdf": ["pdf"],
  "text/plain": ["txt"],
  "text/csv": ["csv"],
  [DOCX]: ["docx"],
  [XLSX]: ["xlsx"]
};

const INLINE: ReadonlySet<HelpdeskAttachmentType> = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Images are shown inline; everything else is served as a download. */
export function isInlineAttachment(type: HelpdeskAttachmentType) {
  return INLINE.has(type);
}

function startsWith(bytes: Uint8Array, signature: string) {
  if (bytes.byteLength < signature.length) return false;
  for (let index = 0; index < signature.length; index += 1) if (bytes[index] !== signature.charCodeAt(index)) return false;
  return true;
}

function extension(fileName: string) {
  const match = /\.([a-z0-9]{1,8})$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : "";
}

/** Entry names from a ZIP central directory, or null when the archive is not well formed. */
function zipEntryNames(bytes: Uint8Array): string[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimum = 22;
  if (bytes.byteLength < minimum) return null;
  let end = -1;
  for (let offset = bytes.byteLength - minimum; offset >= Math.max(0, bytes.byteLength - minimum - 0xffff); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) return null;
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  if (offset + size > end || count === 0) return null;
  const names: string[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: false });
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) return null;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (offset + 46 + nameLength > end) return null;
    names.push(decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

function officeType(bytes: Uint8Array): HelpdeskAttachmentType | null {
  const names = zipEntryNames(bytes);
  if (!names || !names.includes("[Content_Types].xml")) return null;
  // Macro-enabled documents (vbaProject.bin) are not docx/xlsx.
  if (names.some((name) => /(^|\/)vbaProject\.bin$/i.test(name))) return null;
  const word = names.includes("word/document.xml");
  const excel = names.includes("xl/workbook.xml");
  if (word === excel) return null;
  return word ? DOCX : XLSX;
}

const MARKUP_START = /^\s*<(?:!doctype|html|head|body|script|svg|\?xml|iframe|object)\b/i;

function cleanText(bytes: Uint8Array): boolean {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return false; }
  // Tab, line feed, form feed and carriage return are the only control characters allowed.
  if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(text)) return false;
  return !MARKUP_START.test(text.replace(/^﻿/, ""));
}

/** The attachment's real type, or null when it is not one of the allowed types. */
export function sniffAttachment(bytes: Uint8Array, fileName: string): HelpdeskAttachmentType | null {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const image = sniffImage(buffer);
  if (image) return image;
  if (startsWith(bytes, "GIF87a") || startsWith(bytes, "GIF89a")) return "image/gif";
  if (startsWith(bytes, "%PDF-")) return "application/pdf";
  if (startsWith(bytes, "PK\u0003\u0004")) return officeType(bytes);
  const ext = extension(fileName);
  if (ext !== "txt" && ext !== "csv") return null;
  if (!cleanText(bytes)) return null;
  return ext === "csv" ? "text/csv" : "text/plain";
}

const DEFAULT_BASE: Record<HelpdeskAttachmentType, string> = {
  "image/png": "screenshot", "image/jpeg": "screenshot", "image/webp": "screenshot", "image/gif": "screenshot",
  "application/pdf": "attachment", "text/plain": "attachment", "text/csv": "attachment", [DOCX]: "attachment", [XLSX]: "attachment"
};

/** A safe display/download name that always ends with an extension of the detected type. */
export function attachmentFileName(name: string, contentType: HelpdeskAttachmentType): string {
  const allowed = EXTENSIONS[contentType];
  const base = (name.replace(/[\u0000-\u001f\u007f]/g, "").split(/[\\/]/).pop() || "").trim();
  const cleaned = base || DEFAULT_BASE[contentType];
  const suffix = allowed.includes(extension(cleaned)) ? "" : `.${allowed[0]}`;
  const max = HELPDESK_LIMITS.fileNameMax;
  if (cleaned.length + suffix.length <= max) return `${cleaned}${suffix}`;
  if (suffix) return `${cleaned.slice(0, max - suffix.length)}${suffix}`;
  const ext = `.${extension(cleaned)}`;
  return `${cleaned.slice(0, max - ext.length)}${ext}`;
}

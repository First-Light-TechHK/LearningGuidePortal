// Shared byte fixtures for the Helpdesk attachment tests: real magic bytes and
// minimal but well-formed ZIP containers (stored, no compression) so the
// docx/xlsx structure check runs against what Office actually writes.
import { crc32 } from "node:zlib";

export const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
export const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
export const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([4, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
export const GIF = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00", "binary");
export const PDF = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
export const TEXT = Buffer.from("Steps to reproduce:\n1. Sign in\n2. Open the course\n");
export const CSV = Buffer.from("date,amount\n2026-10-01,9.99\n");
export const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
export const HTML = Buffer.from("<!DOCTYPE html><html><body><script>alert(1)</script></body></html>");
export const EXE = Buffer.from("MZ\x90\x00\x03\x00\x00\x00", "binary");

/** A stored (uncompressed) ZIP archive with the given entries. */
export function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const CONTENT_TYPES = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';
export const DOCX = zip({ "[Content_Types].xml": CONTENT_TYPES, "_rels/.rels": "<Relationships/>", "word/document.xml": "<w:document/>" });
export const XLSX = zip({ "[Content_Types].xml": CONTENT_TYPES, "_rels/.rels": "<Relationships/>", "xl/workbook.xml": "<workbook/>", "xl/worksheets/sheet1.xml": "<worksheet/>" });
export const DOCM = zip({ "[Content_Types].xml": CONTENT_TYPES, "word/document.xml": "<w:document/>", "word/vbaProject.bin": "macro" });
export const PLAIN_ZIP = zip({ "readme.txt": "hello" });

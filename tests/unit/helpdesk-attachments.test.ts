import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentFileName, isInlineAttachment, sniffAttachment } from "../../modules/helpdesk/attachments";
import { attachmentResponse } from "../../modules/helpdesk/http";
import nextConfig from "../../next.config";
import { CSV, DOCM, DOCX, EXE, GIF, HTML, JPEG, PDF, PLAIN_ZIP, PNG, SVG, TEXT, WEBP, XLSX } from "./helpdesk-fixtures";

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const sniff = (bytes: Buffer, name: string) => sniffAttachment(new Uint8Array(bytes), name);

test("images and PDF are recognised by their magic bytes, whatever the file is called", () => {
  assert.equal(sniff(PNG, "x.pdf"), "image/png");
  assert.equal(sniff(JPEG, "photo"), "image/jpeg");
  assert.equal(sniff(WEBP, "w.png"), "image/webp");
  assert.equal(sniff(GIF, "anim.gif"), "image/gif");
  assert.equal(sniff(Buffer.from("GIF87a\x01\x00", "binary"), "old.gif"), "image/gif");
  assert.equal(sniff(PDF, "invoice.txt"), "application/pdf");
});

test("docx and xlsx are recognised by their ZIP structure; other archives and macro documents are refused", () => {
  assert.equal(sniff(DOCX, "letter.xlsx"), DOCX_TYPE);
  assert.equal(sniff(XLSX, "sheet.docx"), XLSX_TYPE);
  assert.equal(sniff(DOCM, "macro.docx"), null);
  assert.equal(sniff(PLAIN_ZIP, "archive.docx"), null);
  assert.equal(sniff(Buffer.from("PK\x03\x04garbage", "binary"), "broken.xlsx"), null);
  const truncated = DOCX.subarray(0, DOCX.length - 10);
  assert.equal(sniff(truncated, "cut.docx"), null);
});

test("txt and csv need the extension plus clean UTF-8 text; markup, binaries and NUL bytes are refused", () => {
  assert.equal(sniff(TEXT, "steps.txt"), "text/plain");
  assert.equal(sniff(CSV, "payments.CSV"), "text/csv");
  assert.equal(sniff(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("中文说明")]), "说明.txt"), "text/plain");
  assert.equal(sniff(TEXT, "steps.md"), null, "text without .txt/.csv is not accepted");
  assert.equal(sniff(TEXT, "steps"), null);
  assert.equal(sniff(Buffer.from("abc\u0000def"), "nul.txt"), null);
  assert.equal(sniff(Buffer.from([0x61, 0xff, 0xfe, 0x62]), "latin.txt"), null, "invalid UTF-8");
  assert.equal(sniff(Buffer.from("bell\u0007"), "ctrl.txt"), null);
  assert.equal(sniff(HTML, "page.txt"), null, "html disguised as text");
  assert.equal(sniff(SVG, "image.txt"), null, "svg disguised as text");
  assert.equal(sniff(Buffer.from("  <?xml version=\"1.0\"?><svg/>"), "x.csv"), null);
});

test("html, svg and executables are never accepted", () => {
  assert.equal(sniff(HTML, "page.html"), null);
  assert.equal(sniff(SVG, "image.svg"), null);
  assert.equal(sniff(EXE, "setup.exe"), null);
  assert.equal(sniff(EXE, "setup.txt"), null);
});

test("stored file names are cleaned and always end with an extension that matches the detected type", () => {
  assert.equal(attachmentFileName("x.pdf", "image/png"), "x.pdf.png");
  assert.equal(attachmentFileName("Report.PDF", "application/pdf"), "Report.PDF");
  assert.equal(attachmentFileName("photo.jpeg", "image/jpeg"), "photo.jpeg");
  assert.equal(attachmentFileName("photo.jpg", "image/jpeg"), "photo.jpg");
  assert.equal(attachmentFileName("letter.xlsx", DOCX_TYPE), "letter.xlsx.docx");
  const cleaned = attachmentFileName("../../etc/pass\u0000wd.txt", "text/plain");
  assert.equal(cleaned, "passwd.txt");
  assert.equal(attachmentFileName("", "text/csv"), "attachment.csv");
  assert.equal(attachmentFileName("   ", "image/png"), "screenshot.png");
  const long = attachmentFileName(`${"n".repeat(300)}.xlsx`, XLSX_TYPE);
  assert.ok(long.length <= 120);
  assert.ok(long.endsWith(".xlsx"));
});

test("only images are shown inline; every other type downloads", () => {
  for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif"] as const) assert.equal(isInlineAttachment(type), true, type);
  for (const type of ["application/pdf", "text/plain", "text/csv", DOCX_TYPE, XLSX_TYPE] as const) assert.equal(isInlineAttachment(type), false, type);
});

test("attachment responses: nosniff, sandbox CSP and private no-store always; download disposition for non-images", async () => {
  const pdf = attachmentResponse({ bytes: new Uint8Array(PDF), contentType: "application/pdf", fileName: "invoice 10月.pdf" });
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal(pdf.headers.get("content-disposition"), "attachment; filename*=UTF-8''invoice%2010%E6%9C%88.pdf");
  assert.equal(pdf.headers.get("x-content-type-options"), "nosniff");
  assert.equal(pdf.headers.get("content-security-policy"), "default-src 'none'; sandbox");
  assert.equal(pdf.headers.get("cache-control"), "private, no-store");
  const text = attachmentResponse({ bytes: new Uint8Array(TEXT), contentType: "text/plain", fileName: "steps.txt" });
  assert.equal(text.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.match(text.headers.get("content-disposition") || "", /^attachment;/);
  const image = attachmentResponse({ bytes: new Uint8Array(PNG), contentType: "image/png", fileName: "shot.png" });
  assert.match(image.headers.get("content-disposition") || "", /^inline;/);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), PNG);
  assert.throws(() => attachmentResponse({ bytes: new Uint8Array(SVG), contentType: "image/svg+xml" as never, fileName: "x.svg" }));
});

test("the middleware body clone limit admits five 10 MB attachments plus form overhead", () => {
  const raw = (nextConfig.experimental as { middlewareClientMaxBodySize?: string | number } | undefined)?.middlewareClientMaxBodySize;
  assert.ok(raw !== undefined, "next.config must raise middlewareClientMaxBodySize: Next truncates larger bodies to 10 MB when middleware runs");
  const bytes = typeof raw === "number" ? raw : Number(/^(\d+)mb$/i.exec(String(raw))?.[1]) * 1024 * 1024;
  assert.ok(bytes >= 5 * 10 * 1024 * 1024 + 1024 * 1024, `limit ${raw} is too small`);
  assert.ok(bytes <= 64 * 1024 * 1024, "keep the limit tight");
});

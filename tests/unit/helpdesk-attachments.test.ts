import assert from "node:assert/strict";
import { test } from "node:test";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { attachmentFileName, isInlineAttachment, sniffAttachment, textEncoding } from "../../modules/helpdesk/attachments";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { HelpdeskProblem } from "../../contracts/helpdesk";
import { HELPDESK_MULTIPART_MAX_BYTES, attachmentResponse, readMultipart } from "../../modules/helpdesk/http";
import { config as middlewareConfig } from "../../middleware";
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
  assert.equal(sniff(Buffer.from("bell\u0007"), "ctrl.txt"), null);
  assert.equal(sniff(HTML, "page.txt"), null, "html disguised as text");
  assert.equal(sniff(SVG, "image.txt"), null, "svg disguised as text");
  assert.equal(sniff(Buffer.from("  <?xml version=\"1.0\"?><svg/>"), "x.csv"), null);
});

test("txt and csv in other text encodings are accepted (GBK, Windows-1252, UTF-16 with a BOM); binaries, controls and markup are still refused", () => {
  const gbk = Buffer.from([0xd0, 0xd5, 0xc3, 0xfb, 0x2c, 0xb3, 0xc9, 0xbc, 0xa8, 0x0a, 0xd5, 0xc5, 0xc8, 0xfd, 0x2c, 0x39, 0x30, 0x0a]); // 姓名,成绩\n张三,90\n in GBK
  const cp1252 = Buffer.from([0x4a, 0x6f, 0x73, 0xe9, 0x2c, 0x4d, 0x6f, 0x6e, 0x74, 0x72, 0xe9, 0x61, 0x6c, 0x0d, 0x0a]); // José,Montréal\r\n
  const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Name\tScore\r\n张三\t90\r\n", "utf16le")]);
  const utf16be = Buffer.from(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from("Steps\n1. Sign in\n", "utf16le")]).map((_, index, all) => index < 2 ? all[index] : all[index % 2 === 0 ? index + 1 : index - 1]));
  assert.equal(sniff(gbk, "grades.csv"), "text/csv");
  assert.equal(sniff(cp1252, "list.csv"), "text/csv");
  assert.equal(sniff(Buffer.from([0x61, 0xff, 0xfe, 0x62]), "latin.txt"), "text/plain", "not UTF-8, but text");
  assert.equal(sniff(utf16le, "export.txt"), "text/plain");
  assert.equal(sniff(utf16be, "steps.txt"), "text/plain");
  assert.equal(textEncoding(gbk), "legacy");
  assert.equal(textEncoding(TEXT), "utf-8");
  assert.equal(textEncoding(utf16le), "utf-16le");
  assert.equal(textEncoding(utf16be), "utf-16be");
  assert.equal(sniff(Buffer.from("Name\tScore\r\n", "utf16le"), "no-bom.txt"), null, "UTF-16 without a BOM is full of NUL bytes: looks binary");
  assert.equal(sniff(Buffer.concat([gbk, Buffer.from([0x00])]), "nul.csv"), null);
  assert.equal(sniff(Buffer.concat([cp1252, Buffer.from([0x07])]), "bell.csv"), null);
  assert.equal(sniff(Buffer.concat([Buffer.from([0xe9]), Buffer.from([0x1b, 0x5b])]), "esc.txt"), null);
  assert.equal(sniff(Buffer.concat([Buffer.from("<html><body>"), Buffer.from([0xe9])]), "page.txt"), null, "markup in a legacy encoding");
  assert.equal(sniff(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("<svg onload=alert(1)>", "utf16le")]), "x.txt"), null, "markup in UTF-16");
  assert.equal(sniff(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("a\u0000b", "utf16le")]), "x.txt"), null, "a NUL character in UTF-16");
  assert.equal(sniff(Buffer.from([0xff, 0xfe, 0x41]), "odd.txt"), null, "truncated UTF-16");
  assert.equal(sniff(EXE, "setup.txt"), null);
  assert.equal(sniff(PNG, "shot.txt"), "image/png", "magic bytes still win");
});

test("text attachments are served with the charset they were written in, and none when it is a legacy encoding", () => {
  const gbk = Buffer.from([0xd5, 0xc5, 0xc8, 0xfd, 0x2c, 0x39, 0x30]);
  assert.equal(attachmentResponse({ bytes: new Uint8Array(TEXT), contentType: "text/plain", fileName: "a.txt" }).headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(attachmentResponse({ bytes: new Uint8Array(gbk), contentType: "text/csv", fileName: "a.csv" }).headers.get("content-type"), "text/csv");
  assert.equal(attachmentResponse({ bytes: new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("a,b", "utf16le")])), contentType: "text/csv", fileName: "a.csv" }).headers.get("content-type"), "text/csv; charset=utf-16le");
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

test("next.config keeps Next's default 10 MB middleware body clone limit for every other route", () => {
  // Raising middlewareClientMaxBodySize would let any path (login included)
  // buffer that much in memory. The two Helpdesk upload paths skip the
  // middleware instead (see the matcher test below) and bound their own bodies.
  const experimental = nextConfig.experimental as { middlewareClientMaxBodySize?: string | number } | undefined;
  assert.equal(experimental?.middlewareClientMaxBodySize, undefined);
});

test("the middleware skips only the two Helpdesk multipart upload paths, so their bodies are not cloned or truncated", () => {
  const ticket = "0192d4f0-7b6a-7c3e-9a10-0000000000aa";
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config: middlewareConfig, url, nextConfig });
  assert.equal(matches("/api/helpdesk/tickets"), false);
  assert.equal(matches(`/api/helpdesk/tickets/${ticket}/messages`), false);
  for (const url of [
    "/", "/en-GB/portal", "/en-GB/backoffice", "/api/auth/login", "/api/health", "/api/contact",
    `/api/helpdesk/tickets/${ticket}`, `/api/helpdesk/tickets/${ticket}/actions`, `/api/helpdesk/tickets/${ticket}/messages/extra`,
    "/api/helpdesk/tickets-export", "/api/helpdesk/ticketsx", "/api/helpdesk/attachments/x", "/api/helpdesk/suggestions",
    "/api/integration/helpdesk/tickets", `/api/integration/helpdesk/tickets/${ticket}/messages`, "/x/api/helpdesk/tickets"
  ]) assert.equal(matches(url), true, url);
});

function multipartRequest(body: BodyInit | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/helpdesk/tickets", { method: "POST", headers, body, duplex: "half" } as RequestInit);
}

async function tooLarge(promise: Promise<unknown>) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof HelpdeskProblem, String(error));
    assert.equal(error.code, "attachment_too_large");
    assert.equal(error.status, 413);
    return true;
  });
}

test("multipart bodies are bounded: five 10 MB files plus 1 MB for fields and framing", () => {
  assert.equal(HELPDESK_MULTIPART_MAX_BYTES, 5 * 10 * 1024 * 1024 + 1024 * 1024);
});

test("readMultipart answers 413 from Content-Length alone, before reading any of the body", async () => {
  let pulled = false;
  // highWaterMark 0: nothing is pulled until someone actually reads.
  const body = new ReadableStream<Uint8Array>({ pull() { pulled = true; throw new Error("the body must not be read"); } }, { highWaterMark: 0 });
  await tooLarge(readMultipart(multipartRequest(body, { "content-type": "multipart/form-data; boundary=x", "content-length": String(HELPDESK_MULTIPART_MAX_BYTES + 1) })));
  assert.equal(pulled, false);
});

test("readMultipart stops reading and answers 413 once a body without Content-Length passes the bound", { timeout: 20_000 }, async () => {
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    // Finite (the bound plus 8 MB) so a reader that ignores the bound finishes instead of hanging.
    pull(controller) {
      if (sent >= HELPDESK_MULTIPART_MAX_BYTES + 8 * chunk.byteLength) { controller.close(); return; }
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
    cancel() { cancelled = true; }
  });
  await tooLarge(readMultipart(multipartRequest(body, { "content-type": "multipart/form-data; boundary=x" })));
  assert.ok(sent <= HELPDESK_MULTIPART_MAX_BYTES + 2 * chunk.byteLength, `read ${sent} bytes`);
  assert.equal(cancelled, true);
});

test("readMultipart streams the body into the multipart parser instead of first buffering a whole copy of it", { timeout: 30_000 }, async () => {
  setFlagsFromString("--expose-gc");
  const gc = runInNewContext("gc") as () => void;
  const boundary = "lg-boundary";
  const part = (name: string) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files[]"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const chunkSize = 1024 * 1024;
  const perFile = 8;
  // Three 8 MB files in 1 MB chunks, made only when the reader pulls them.
  const pieces: Array<() => Uint8Array> = [() => new Uint8Array(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="subject"\r\n\r\nBig files\r\n`))];
  for (const name of ["a.bin", "b.bin", "c.bin"]) {
    pieces.push(() => new Uint8Array(part(name)));
    for (let index = 0; index < perFile; index += 1) pieces.push(() => new Uint8Array(chunkSize).fill(0x41));
    pieces.push(() => new Uint8Array(Buffer.from("\r\n")));
  }
  pieces.push(() => new Uint8Array(Buffer.from(`--${boundary}--\r\n`)));
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = pieces.shift();
      if (next) controller.enqueue(next()); else controller.close();
    }
  }, { highWaterMark: 0 });
  const original = Response.prototype.formData;
  let heldWhenParsingStarts = Number.NaN;
  gc();
  const baseline = process.memoryUsage().arrayBuffers;
  Response.prototype.formData = function (this: Response) {
    gc();
    heldWhenParsingStarts = process.memoryUsage().arrayBuffers - baseline;
    return original.call(this);
  };
  try {
    const { fields, files } = await readMultipart(multipartRequest(body, { "content-type": `multipart/form-data; boundary=${boundary}` }));
    assert.equal(fields.subject, "Big files");
    assert.deepEqual(files.map((item) => [item.fileName, item.bytes.byteLength, item.bytes[perFile * chunkSize - 1]]), [["a.bin", perFile * chunkSize, 0x41], ["b.bin", perFile * chunkSize, 0x41], ["c.bin", perFile * chunkSize, 0x41]]);
  } finally {
    Response.prototype.formData = original;
  }
  assert.ok(heldWhenParsingStarts < 4 * chunkSize, `held ${Math.round(heldWhenParsingStarts / chunkSize)} MB of the ${3 * perFile} MB body before parsing`);
});

test("readMultipart still reads fields and files under the bound, and refuses a body that is not multipart", async () => {
  const form = new FormData();
  form.set("subject", "Cannot log in");
  form.set("ignored", "x");
  form.append("files[]", new Blob([new Uint8Array(PNG)], { type: "image/png" }), "shot.png");
  const encoded = new Response(form);
  const request = multipartRequest(await encoded.arrayBuffer(), { "content-type": encoded.headers.get("content-type") || "" });
  const { fields, files } = await readMultipart(request);
  assert.equal(fields.subject, "Cannot log in");
  assert.equal(files.length, 1);
  assert.equal(files[0].fileName, "shot.png");
  assert.deepEqual(Buffer.from(files[0].bytes), PNG);
  await assert.rejects(readMultipart(multipartRequest("{}", { "content-type": "application/json" })), (error: unknown) => error instanceof HelpdeskProblem && error.code === "invalid_request");
});

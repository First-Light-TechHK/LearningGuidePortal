import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentFileName, isInlineAttachment, sniffAttachment } from "../../modules/helpdesk/attachments";
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

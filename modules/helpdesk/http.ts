// HTTP plumbing shared by the Helpdesk Route Handlers: session / bearer
// authorisation, Idempotency-Key, multipart reading, RFC 9457 problems and
// plain-JSON success bodies. No business rules here.
import { createHash, timingSafeEqual } from "node:crypto";
import { HELPDESK_ATTACHMENT_TYPES, HELPDESK_LIMITS, HelpdeskProblem, isTicketId, parseIdempotencyKey, problemBody, type HelpdeskAttachmentType, type UploadInput } from "@/contracts/helpdesk";
import { isInlineAttachment } from "./attachments";
import { adminHostDecision, requestOriginMatches } from "@/services/adminHost";
import { currentProductUserFromRequest } from "@/services/productAuth";
import type { LearnerIdentity } from "./service";

const NO_STORE = "no-store";

export function problemResponse(error: unknown, scope: string): Response {
  const problem = error instanceof HelpdeskProblem ? error : null;
  if (!problem) console.error(JSON.stringify({ type: "helpdesk", event: "request_failed", scope, error: error instanceof Error ? error.name : "unknown" }));
  const resolved = problem ?? new HelpdeskProblem("helpdesk_unavailable");
  const headers: Record<string, string> = { "Content-Type": "application/problem+json", "Cache-Control": NO_STORE };
  if (resolved.code === "invalid_token") headers["WWW-Authenticate"] = 'Bearer realm="learning-guide-helpdesk", error="invalid_token"';
  if (resolved.code === "rate_limited" && typeof resolved.extra.retryAfter === "number") headers["Retry-After"] = String(resolved.extra.retryAfter);
  return new Response(JSON.stringify(problemBody(resolved)), { status: resolved.status, headers });
}

export function jsonResponse(body: unknown, status = 200, replayed = false): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": NO_STORE };
  if (replayed) headers["Idempotent-Replayed"] = "true";
  return new Response(JSON.stringify(body), { status: replayed ? 200 : status, headers });
}

/**
 * Stored attachment bytes. Only the allow-listed types are ever served (never
 * html or svg); images inline, everything else as a download; always nosniff,
 * a sandbox CSP and private, no-store.
 */
export function attachmentResponse(content: { bytes: Uint8Array; contentType: HelpdeskAttachmentType; fileName: string }): Response {
  if (!(HELPDESK_ATTACHMENT_TYPES as readonly string[]).includes(content.contentType)) throw new HelpdeskProblem("not_found", "No such attachment.");
  const textual = content.contentType.startsWith("text/");
  return new Response(new Uint8Array(content.bytes), {
    status: 200,
    headers: {
      "Content-Type": textual ? `${content.contentType}; charset=utf-8` : content.contentType,
      "Content-Length": String(content.bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": `${isInlineAttachment(content.contentType) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(content.fileName)}`
    }
  });
}

/**
 * middleware.ts does not run on the two Helpdesk upload paths (so their large
 * bodies are not cloned), so their handlers apply the same admin-host rule
 * first: the identical 404 / 307 the middleware would have answered, or null.
 */
export function adminHostResponse(request: Request): Response | null {
  const decision = adminHostDecision(request);
  if (decision.allow) return null;
  if (decision.status === 404) return new Response("Not Found", { status: 404 });
  if (decision.status === 307 && decision.location) return Response.redirect(new URL(decision.location, request.url), 307);
  return null;
}

export async function requireLearner(request: Request, options: { write?: boolean } = {}): Promise<LearnerIdentity> {
  const user = await currentProductUserFromRequest(request);
  if (!user) throw new HelpdeskProblem("unauthenticated", "Sign in to contact support.");
  if (options.write && !requestOriginMatches(request)) throw new HelpdeskProblem("forbidden_origin");
  return { id: user.id, email: user.email || "", name: user.nickname || "" };
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

/** RFC 6750 bearer token, compared in constant time; PORTAL_HELPDESK_TOKEN is read on every request. */
export function requireIntegration(request: Request): void {
  const expected = process.env.PORTAL_HELPDESK_TOKEN?.trim();
  if (!expected) throw new HelpdeskProblem("integration_disabled", "PORTAL_HELPDESK_TOKEN is not configured on Portal.");
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  const provided = match ? match[1] : "";
  if (!provided || !timingSafeEqual(digest(provided), digest(expected))) throw new HelpdeskProblem("invalid_token", "The service token is missing or invalid.");
}

export function idempotencyKey(request: Request): string {
  return parseIdempotencyKey(request.headers.get("idempotency-key"));
}

export async function ticketIdParam(context: { params: Promise<Record<string, string>> }, key = "id"): Promise<string> {
  const value = (await context.params)[key];
  if (!isTicketId(value)) throw new HelpdeskProblem("not_found", "Not found.");
  return value.toLowerCase();
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { throw new HelpdeskProblem("invalid_request", "Send a JSON body."); }
}

/**
 * Largest multipart body a learner may send: five 10 MB files plus 1 MB for
 * the text fields and multipart framing. The two upload Route Handlers are
 * excluded from the middleware (middleware.ts), so Next neither clones nor
 * truncates their bodies; this bound is what keeps them from buffering more.
 */
export const HELPDESK_MULTIPART_MAX_BYTES = HELPDESK_LIMITS.filesPerMessage * HELPDESK_LIMITS.fileMaxBytes + 1024 * 1024;

function bodyTooLarge() {
  return new HelpdeskProblem("attachment_too_large", `Attach at most ${HELPDESK_LIMITS.filesPerMessage} files of 10 MB each.`);
}

/**
 * The request body as a pass-through stream: 413 up front from Content-Length,
 * or as soon as the bytes that went through pass the bound (the source is
 * then cancelled). Nothing is collected here, so the multipart parser holds
 * the only copy of the raw body.
 */
function boundedBody(request: Request, max: number, onTooLarge: () => void): ReadableStream<Uint8Array> | null {
  const declared = request.headers.get("content-length")?.trim();
  if (declared && /^\d+$/.test(declared) && Number(declared) > max) throw bodyTooLarge();
  if (!request.body) return null;
  let total = 0;
  return request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > max) { onTooLarge(); controller.error(bodyTooLarge()); return; }
      controller.enqueue(chunk);
    }
  }));
}

/** multipart/form-data: text fields plus files under "files[]" (or "files"), at most HELPDESK_MULTIPART_MAX_BYTES in all. */
export async function readMultipart(request: Request): Promise<{ fields: Record<string, unknown>; files: UploadInput[] }> {
  let tooLarge = false;
  const body = boundedBody(request, HELPDESK_MULTIPART_MAX_BYTES, () => { tooLarge = true; });
  let form: FormData;
  try {
    form = await new Response(body, { headers: { "content-type": request.headers.get("content-type") || "" } }).formData();
  } catch {
    if (tooLarge) throw bodyTooLarge();
    throw new HelpdeskProblem("invalid_request", "Send multipart/form-data.");
  }
  const fields: Record<string, unknown> = {};
  const files: UploadInput[] = [];
  for (const [name, value] of form.entries()) {
    if (typeof value === "string") { if (name !== "files[]" && name !== "files") fields[name] = value; continue; }
    if (name !== "files[]" && name !== "files") continue;
    // The parser already holds every part; checking here only avoids copying the bytes of a request the contract would refuse anyway.
    if (files.length >= HELPDESK_LIMITS.filesPerMessage) throw new HelpdeskProblem("too_many_attachments", `Attach at most ${HELPDESK_LIMITS.filesPerMessage} files.`);
    if (value.size > HELPDESK_LIMITS.fileMaxBytes) throw new HelpdeskProblem("attachment_too_large", "Each file must be 10 MB or smaller.");
    files.push({ fileName: value.name, declaredType: value.type, bytes: new Uint8Array(await value.arrayBuffer()) });
  }
  return { fields, files };
}

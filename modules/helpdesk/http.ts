// HTTP plumbing shared by the Helpdesk Route Handlers: session / bearer
// authorisation, Idempotency-Key, multipart reading, RFC 9457 problems and
// plain-JSON success bodies. No business rules here.
import { createHash, timingSafeEqual } from "node:crypto";
import { HELPDESK_LIMITS, HelpdeskProblem, isTicketId, parseIdempotencyKey, problemBody, type UploadInput } from "@/contracts/helpdesk";
import { requestOriginMatches } from "@/services/adminHost";
import { currentProductUserFromRequest } from "@/services/productAuth";
import type { LearnerIdentity } from "./service";

const NO_STORE = "no-store";

export function problemResponse(error: unknown, scope: string): Response {
  const problem = error instanceof HelpdeskProblem ? error : null;
  if (!problem) console.error(JSON.stringify({ type: "helpdesk", event: "request_failed", scope, error: error instanceof Error ? error.name : "unknown" }));
  const resolved = problem ?? new HelpdeskProblem("helpdesk_unavailable");
  const headers: Record<string, string> = { "Content-Type": "application/problem+json", "Cache-Control": NO_STORE };
  if (resolved.code === "invalid_token") headers["WWW-Authenticate"] = 'Bearer realm="learning-guide-helpdesk", error="invalid_token"';
  return new Response(JSON.stringify(problemBody(resolved)), { status: resolved.status, headers });
}

export function jsonResponse(body: unknown, status = 200, replayed = false): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": NO_STORE };
  if (replayed) headers["Idempotent-Replayed"] = "true";
  return new Response(JSON.stringify(body), { status: replayed ? 200 : status, headers });
}

export function attachmentResponse(content: { bytes: Uint8Array; contentType: string; fileName: string }): Response {
  return new Response(new Uint8Array(content.bytes), {
    status: 200,
    headers: {
      "Content-Type": content.contentType,
      "Content-Length": String(content.bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(content.fileName)}`
    }
  });
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

/** multipart/form-data: text fields plus files under "files[]" (or "files"). */
export async function readMultipart(request: Request): Promise<{ fields: Record<string, unknown>; files: UploadInput[] }> {
  let form: FormData;
  try { form = await request.formData(); } catch { throw new HelpdeskProblem("invalid_request", "Send multipart/form-data."); }
  const fields: Record<string, unknown> = {};
  const files: UploadInput[] = [];
  for (const [name, value] of form.entries()) {
    if (typeof value === "string") { if (name !== "files[]" && name !== "files") fields[name] = value; continue; }
    if (name !== "files[]" && name !== "files") continue;
    // Fail before buffering bytes we would reject anyway (the contract re-checks).
    if (files.length >= HELPDESK_LIMITS.filesPerMessage) throw new HelpdeskProblem("too_many_attachments", `Attach at most ${HELPDESK_LIMITS.filesPerMessage} images.`);
    if (value.size > HELPDESK_LIMITS.fileMaxBytes) throw new HelpdeskProblem("attachment_too_large", "Each image must be 5 MB or smaller.");
    files.push({ fileName: value.name, declaredType: value.type, bytes: new Uint8Array(await value.arrayBuffer()) });
  }
  return { fields, files };
}

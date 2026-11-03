// HTTP plumbing for the Student Management integration routes: bearer authorisation and RFC 9457 problems.
// No business rules here.
import { createHash, timingSafeEqual } from "node:crypto";
import { StudentProblem, studentProblemBody } from "@/contracts/student-management";

const NO_STORE = "private, no-store";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

/**
 * The Backoffice service token, read on every request (rotation needs no redeploy). PORTAL_STUDENTS_TOKEN when set;
 * otherwise the existing Backoffice integration token PORTAL_HELPDESK_TOKEN, so environments that already connect
 * the Backoffice need no new secret.
 */
export function requireStudentIntegration(request: Request): void {
  const expected = process.env.PORTAL_STUDENTS_TOKEN?.trim() || process.env.PORTAL_HELPDESK_TOKEN?.trim();
  if (!expected) throw new StudentProblem("integration_disabled", "The Backoffice integration token is not configured on Portal.");
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") || "");
  const provided = match ? match[1] : "";
  if (!provided || !timingSafeEqual(digest(provided), digest(expected))) throw new StudentProblem("invalid_token", "The service token is missing or invalid.");
}

export async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { throw new StudentProblem("validation_failed", "Send a JSON body.", "body"); }
}

export function studentJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": NO_STORE } });
}

export function studentProblem(error: unknown, scope: string): Response {
  const problem = error instanceof StudentProblem ? error : null;
  if (!problem) {
    const code = (error as { code?: unknown } | null)?.code;
    console.error(JSON.stringify({ type: "student-management", event: "request_failed", scope, error: error instanceof Error ? error.name : "unknown", ...(typeof code === "string" && code.length <= 64 ? { code } : {}) }));
  }
  const resolved = problem ?? new StudentProblem("students_unavailable", "Student Management is unavailable. Try again.");
  const headers: Record<string, string> = { "Content-Type": "application/problem+json", "Cache-Control": NO_STORE };
  if (resolved.code === "invalid_token") headers["WWW-Authenticate"] = 'Bearer realm="learning-guide-students", error="invalid_token"';
  return new Response(JSON.stringify(studentProblemBody(resolved)), { status: resolved.status, headers });
}

const USER_ID = /^[A-Za-z0-9_-]{1,80}$/;

export async function studentIdParam(context: { params: Promise<Record<string, string>> }): Promise<string> {
  const value = (await context.params).id;
  if (!value || !USER_ID.test(value)) throw new StudentProblem("not_found", "No such student.");
  return value;
}

import { NextResponse } from "next/server";

/**
 * Shared plumbing for the Admin → Portal notification integration routes
 * (design §1/§3): JSON parsing, operator extraction and uniform errors.
 */

export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export function notificationJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function readNotificationJson(request: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: notificationJson({ ok: false, code: "invalid_request", error: "Send a JSON body." }, 400) };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, response: notificationJson({ ok: false, code: "invalid_request", error: "Send a JSON object." }, 400) };
  }
  return { ok: true, body: body as Record<string, unknown> };
}

/**
 * The Backoffice operator is passed by Admin in the body (or an
 * x-operator-email header) and recorded on every write (PRD §11.3).
 */
export function operatorFrom(request: Request, body: Record<string, unknown> = {}): string {
  const candidate = [body.operator, body.operatorEmail, body.operatorId]
    .find((value) => typeof value === "string" && value.trim()) as string | undefined;
  const header = request.headers.get("x-operator-email") || request.headers.get("x-operator");
  return (candidate || header || "").trim();
}

export function missingOperatorResponse() {
  return notificationJson({ ok: false, code: "invalid_request", error: "operator is required." }, 400);
}

export function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

export function nullableStringField(body: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

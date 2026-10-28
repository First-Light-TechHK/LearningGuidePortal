import { NextResponse } from "next/server";
import { currentProductUserFromRequest } from "@/services/productAuth";
import { StudyGroupError } from "./domain";

const statusFor: Record<string, number> = {
  unauthenticated: 401,
  validation: 400,
  start_in_past: 400,
  course_access_required: 403,
  course_unavailable: 409,
  forbidden: 403,
  session_time_only: 403,
  not_found: 404,
  conflict: 409,
  session_full: 409,
  session_not_open: 409,
  session_unavailable: 409,
  tutor_busy: 409,
  tutor_rate_limited: 429,
  tutor_answering: 409,
  tutor_unavailable: 503,
  seat_lapsed: 409,
  unavailable: 503,
  livekit_temporarily_unavailable: 503
};

export function studyGroupData(data: unknown, status = 200) {
  return NextResponse.json({ ok: true, code: "ok", message: "", data }, { status });
}

export function studyGroupFailure(error: unknown) {
  if (error instanceof StudyGroupError) {
    const status = statusFor[error.code] || 400;
    return NextResponse.json({ ok: false, code: error.code, message: error.message, data: null }, { status });
  }
  if (error instanceof SyntaxError) return NextResponse.json({ ok: false, code: "validation", message: "Request body is not valid JSON.", data: null }, { status: 400 });
  return NextResponse.json({ ok: false, code: "error", message: "Study Group request failed.", data: null }, { status: 500 });
}

// A request body is a JSON object; `null`, an array or a bare value is a
// validation failure (400), not a TypeError on the first field read (500).
export async function readJsonObject<T extends object>(request: Request): Promise<Partial<T>> {
  const body: unknown = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new StudyGroupError("validation", "Request body must be a JSON object.");
  return body as Partial<T>;
}

export function unauthenticated() {
  return NextResponse.json({ ok: false, code: "unauthenticated", message: "Sign in is required.", data: null }, { status: 401 });
}

export async function signedInUser(request: Request) {
  return currentProductUserFromRequest(request);
}

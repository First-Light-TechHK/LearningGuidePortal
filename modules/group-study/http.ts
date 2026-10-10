import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { StudyGroupError } from "./domain";

const statusFor: Record<string, number> = {
  unauthenticated: 401,
  validation: 400,
  course_access_required: 403,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  session_full: 409,
  session_not_open: 409,
  session_unavailable: 409,
  unavailable: 503
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

export function unauthenticated() {
  return NextResponse.json({ ok: false, code: "unauthenticated", message: "Sign in is required.", data: null }, { status: 401 });
}

export async function signedInUser(request: Request) {
  return currentProductUser(request);
}

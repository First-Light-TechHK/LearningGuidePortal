import { NextResponse } from "next/server";
import { deliverPasswordReset } from "@/services/passwordResetService";
import type { PasswordResetRequest } from "@/contracts/passwordReset";

export async function POST(request: Request) {
  try {
    const body = await request.json() as PasswordResetRequest;
    if (typeof body.email !== "string" || (body.returnTo !== undefined && typeof body.returnTo !== "string")) return NextResponse.json({ ok: false, code: "invalid_request" }, { status: 400 });
    const result = await deliverPasswordReset(body, request);
    return NextResponse.json({ ok: true, accepted: result.accepted, retryAfter: result.retryAfter });
  } catch (error) {
    const code = error instanceof Error && error.message === "email_unavailable" ? "email_unavailable" : "invalid_request";
    return NextResponse.json({ ok: false, code }, { status: code === "email_unavailable" ? 503 : 400 });
  }
}

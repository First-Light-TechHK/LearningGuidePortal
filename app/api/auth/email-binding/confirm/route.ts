import { NextResponse } from "next/server";
import { completeEmailBinding } from "@/services/emailBindingService";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "@/services/productAuth";
import { secureAuthCookie } from "@/services/runtimeConfig";
import type { EmailBindingConfirmation } from "@/contracts/emailBinding";

export async function POST(request: Request) {
  try {
    const body = await request.json() as EmailBindingConfirmation;
    const result = await completeEmailBinding(body, request);
    const response = NextResponse.json({ ok: true, alreadyBound: result.alreadyBound, merged: result.merged, sameUser: result.sameUser, continueUrl: result.continueUrl }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
    if (result.sessionToken) response.cookies.set(SESSION_COOKIE, result.sessionToken, { httpOnly: true, sameSite: "lax", secure: secureAuthCookie(request), path: "/", maxAge: SESSION_MAX_AGE });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_link";
    const code = ["email_in_use", "account_unavailable", "account_conflict", "source_has_history", "confirmation_required"].includes(message) ? message : "invalid_link";
    return NextResponse.json({ ok: false, code }, { status: 400, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  }
}

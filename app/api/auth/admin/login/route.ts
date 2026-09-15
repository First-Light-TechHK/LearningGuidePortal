import { secureAuthCookie } from "@/services/runtimeConfig";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { isAdminHost } from "@/services/adminHost";
import { authenticateUser, createSession, isOperator, publicUser } from "@/services/productStore";
import { ADMIN_SESSION_COOKIE, SESSION_MAX_AGE } from "@/services/productAuth";

export async function POST(request: Request) {
  const requestId = randomUUID();
  if (!isAdminHost(request)) return NextResponse.json({ ok: false, code: "NOT_FOUND", message: "Not Found.", requestId }, { status: 404 });
  try {
    const body = await request.json() as { email?: string; password?: string; rememberMe?: boolean };
    const user = await authenticateUser(body.email || "", body.password || "");
    if (!isOperator(user)) return NextResponse.json({ ok: false, code: "OPERATOR_REQUIRED", message: "Course Manager/Operator access is required.", requestId }, { status: 403 });
    const session = await createSession(user.id);
    const response = NextResponse.json({ ok: true, data: { user: publicUser(user) }, requestId });
    response.cookies.set(ADMIN_SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", secure: secureAuthCookie(request), path: "/", ...(body.rememberMe === true ? { maxAge: SESSION_MAX_AGE } : {}) });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign in failed.";
    return NextResponse.json({ ok: false, code: message.startsWith("Verify") ? "EMAIL_NOT_VERIFIED" : "AUTHENTICATION_FAILED", message, requestId }, { status: message.startsWith("Verify") ? 403 : 401 });
  }
}

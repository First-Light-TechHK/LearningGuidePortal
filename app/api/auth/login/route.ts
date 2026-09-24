import { secureAuthCookie } from "@/services/runtimeConfig";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { authenticateUser, createSession, publicUser } from "@/services/productStore";
import { AUTH_SESSION_MAX_AGE, SESSION_COOKIE } from "@/services/productAuth";

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const body = await request.json() as { email?: string; password?: string; rememberMe?: boolean };
    const user = await authenticateUser(body.email || "", body.password || "");
    const session = await createSession(user.id, { replaceExisting: true, maxAgeSeconds: AUTH_SESSION_MAX_AGE });
    const response = NextResponse.json({ ok: true, data: { user: publicUser(user) }, requestId });
    response.cookies.set(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", secure: secureAuthCookie(request), path: "/", ...(body.rememberMe === true ? { maxAge: AUTH_SESSION_MAX_AGE } : {}) });
    return response;
  } catch {
    return NextResponse.json({ ok: false, code: "AUTHENTICATION_FAILED", requestId }, { status: 401 });
  }
}

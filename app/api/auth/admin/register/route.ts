import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { isAdminHost, requestHostname } from "@/services/adminHost";
import { emailRegistrationHttp, registerEmailAccount } from "@/services/emailRegistration";
import { ADMIN_SESSION_COOKIE, SESSION_MAX_AGE } from "@/services/productAuth";
import { secureAuthCookie } from "@/services/runtimeConfig";

export async function POST(request: Request) {
  const requestId = randomUUID();
  if (!isAdminHost(request)) return NextResponse.json({ ok: false, code: "NOT_FOUND", message: "Not Found.", requestId }, { status: 404 });
  try {
    const body = await request.json() as { email?: unknown; password?: unknown; nickname?: unknown; locale?: unknown };
    const email = (typeof body?.email === "string" ? body.email : "").trim().toLowerCase();
    const operatorEmail = process.env.BACKOFFICE_OPERATOR_EMAIL?.trim().toLowerCase();
    if (!operatorEmail || email !== operatorEmail) return NextResponse.json({ ok: false, code: "OPERATOR_REQUIRED", message: "Only the configured operator email can register on the backoffice host.", requestId }, { status: 403 });
    const result = await registerEmailAccount({
      email,
      password: body?.password,
      nickname: typeof body?.nickname === "string" && body.nickname.trim() ? body.nickname : "Operator",
      locale: body?.locale,
      role: "operator",
      verificationOrigin: () => {
        const proto = request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "");
        return `${proto}://${requestHostname(request)}`;
      },
    });
    const mapped = emailRegistrationHttp(result, requestId);
    const response = NextResponse.json(mapped.body, { status: mapped.status });
    if (mapped.sessionToken) response.cookies.set(ADMIN_SESSION_COOKIE, mapped.sessionToken, { httpOnly: true, sameSite: "lax", secure: secureAuthCookie(request), path: "/", maxAge: SESSION_MAX_AGE });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registration failed.";
    return NextResponse.json({ ok: false, code: "REGISTRATION_FAILED", message, requestId }, { status: 400 });
  }
}

import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "@/services/productAuth";
import { emailRegistrationHttp, registerEmailAccount } from "@/services/emailRegistration";
import { publicAppOrigin, secureAuthCookie } from "@/services/runtimeConfig";

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const body = await request.json() as { email?: unknown; password?: unknown; nickname?: unknown; locale?: unknown };
    const result = await registerEmailAccount({
      email: body?.email,
      password: body?.password,
      nickname: body?.nickname,
      locale: body?.locale,
      verificationOrigin: () => publicAppOrigin(request),
    });
    const mapped = emailRegistrationHttp(result, requestId);
    const response = NextResponse.json(mapped.body, { status: mapped.status });
    if (mapped.sessionToken) response.cookies.set(SESSION_COOKIE, mapped.sessionToken, { httpOnly: true, sameSite: "lax", secure: secureAuthCookie(request), path: "/", maxAge: SESSION_MAX_AGE });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registration failed.";
    const tooSoon = message.includes("wait before requesting");
    return NextResponse.json({ ok: false, code: tooSoon ? "VERIFICATION_RATE_LIMITED" : "REGISTRATION_FAILED", message, requestId }, { status: tooSoon ? 429 : 400 });
  }
}

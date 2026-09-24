import { secureAuthCookie } from "@/services/runtimeConfig";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { isAdminHost, requestHostname } from "@/services/adminHost";
import { createSession, issueEmailVerificationToken, publicUser, registerUserAttempt, verifyEmailToken } from "@/services/productStore";
import { ADMIN_SESSION_COOKIE, SESSION_MAX_AGE } from "@/services/productAuth";
import { emailDeliveryConfigured, sendVerificationEmail } from "@/services/emailService";
import { emailVerificationRequired } from "@/services/runtimeConfig";

export async function POST(request: Request) {
  const requestId = randomUUID();
  if (!isAdminHost(request)) return NextResponse.json({ ok: false, code: "NOT_FOUND", requestId }, { status: 404 });
  try {
    const body = await request.json() as { email?: string; password?: string; nickname?: string; locale?: "en-GB" | "zh-CN" };
    const email = (body.email || "").trim().toLowerCase();
    const operatorEmail = process.env.BACKOFFICE_OPERATOR_EMAIL?.trim().toLowerCase();
    if (!operatorEmail || email !== operatorEmail) return NextResponse.json({ ok: false, code: "OPERATOR_REQUIRED", requestId }, { status: 403 });
    const verificationRequired = emailVerificationRequired();
    if (verificationRequired && !emailDeliveryConfigured()) return NextResponse.json({ ok: false, code: "EMAIL_DELIVERY_NOT_CONFIGURED", requestId }, { status: 503 });
    const { user, created } = await registerUserAttempt({ email, password: body.password || "", nickname: body.nickname || "Operator", locale: body.locale, role: "operator" });
    if (!created) return NextResponse.json({ ok: true, data: { verificationRequired: false }, requestId });
    const verificationToken = await issueEmailVerificationToken(user.id, true);
    const locale = body.locale === "zh-CN" ? "zh-CN" : "en-GB";
    const proto = request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "");
    const origin = `${proto}://${requestHostname(request)}`;
    if (verificationRequired) {
      await sendVerificationEmail({ to: user.email || email, url: `${origin}/${locale}/portal/verify-email?token=${encodeURIComponent(verificationToken)}`, locale });
      return NextResponse.json({ ok: true, data: { user: publicUser(user), verificationRequired: true }, requestId });
    }
    const activatedUser = await verifyEmailToken(verificationToken);
    const session = await createSession(user.id);
    const response = NextResponse.json({ ok: true, data: { user: publicUser(activatedUser), verificationRequired: false }, requestId });
    response.cookies.set(ADMIN_SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", secure: secureAuthCookie(request), path: "/", maxAge: SESSION_MAX_AGE });
    return response;
  } catch {
    return NextResponse.json({ ok: false, code: "REGISTRATION_FAILED", requestId }, { status: 400 });
  }
}

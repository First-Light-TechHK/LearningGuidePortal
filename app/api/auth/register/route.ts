import { secureAuthCookie } from "@/services/runtimeConfig";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createSession, issueEmailVerificationToken, publicUser, registerUser, verifyEmailToken } from "@/services/productStore";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "@/services/productAuth";
import { emailDeliveryConfigured, sendVerificationEmail } from "@/services/emailService";
import { appEnvironment, emailVerificationRequired, publicAppOrigin } from "@/services/runtimeConfig";

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const body = await request.json() as { email?: string; password?: string; nickname?: string; locale?: "en-GB" | "zh-CN" };
    const verificationRequired = emailVerificationRequired();
    if (verificationRequired && !emailDeliveryConfigured()) return NextResponse.json({ ok: false, code: "EMAIL_DELIVERY_NOT_CONFIGURED", message: `Email verification is not configured for ${appEnvironment()}.`, requestId }, { status: 503 });
    const user = await registerUser({ email: body.email || "", password: body.password || "", nickname: body.nickname, locale: body.locale });
    const verificationToken = await issueEmailVerificationToken(user.id, true);
    const locale = body.locale === "zh-CN" ? "zh-CN" : "en-GB";
    if (verificationRequired) {
      const verificationUrl = `${publicAppOrigin(request)}/${locale}/portal/verify-email?token=${encodeURIComponent(verificationToken)}`;
      await sendVerificationEmail({ to: user.email, url: verificationUrl, locale });
      return NextResponse.json({ ok: true, data: { user: publicUser(user), verificationRequired: true }, requestId });
    }
    const activatedUser = await verifyEmailToken(verificationToken);
    const session = await createSession(user.id);
    const response = NextResponse.json({ ok: true, data: { user: publicUser(activatedUser), verificationRequired: false }, requestId });
    response.cookies.set(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", secure: secureAuthCookie(request), path: "/", maxAge: SESSION_MAX_AGE });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registration failed.";
    if (message.includes("already exists")) {
      return NextResponse.json({ ok: true, data: { verificationRequired: emailVerificationRequired() }, requestId });
    }
    const tooSoon = message.includes("wait before requesting");
    return NextResponse.json({ ok: false, code: tooSoon ? "VERIFICATION_RATE_LIMITED" : "REGISTRATION_FAILED", message, requestId }, { status: tooSoon ? 429 : 400 });
  }
}

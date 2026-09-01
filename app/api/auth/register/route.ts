import { NextResponse } from "next/server";
import { createSession, issueEmailVerificationToken, publicUser, registerUser } from "@/services/productStore";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "@/services/productAuth";
import { emailDeliveryConfigured, sendVerificationEmail } from "@/services/emailService";
import { appEnvironment, appOrigin, isProductionEnvironment } from "@/services/runtimeConfig";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string; password?: string; nickname?: string; locale?: "en-GB" | "zh-CN" };
    if (isProductionEnvironment() && !emailDeliveryConfigured()) return NextResponse.json({ ok: false, error: `Email verification is not configured for ${appEnvironment()}.` }, { status: 503 });
    const user = await registerUser({ email: body.email || "", password: body.password || "", nickname: body.nickname, locale: body.locale });
    const verificationToken = user.emailVerifiedAt ? null : await issueEmailVerificationToken(user.id);
    const locale = body.locale === "zh-CN" ? "zh-CN" : "en-GB";
    if (verificationToken && isProductionEnvironment()) {
      const verificationUrl = `${appOrigin(request)}/${locale}/portal/verify-email?token=${encodeURIComponent(verificationToken)}`;
      await sendVerificationEmail({ to: user.email, url: verificationUrl });
      return NextResponse.json({ ok: true, user: publicUser(user), verificationRequired: true, verificationUrl: null });
    }
    const session = await createSession(user.id);
    const verificationUrl = verificationToken ? `/${locale}/portal/verify-email?token=${encodeURIComponent(verificationToken)}` : null;
    const response = NextResponse.json({ ok: true, user: publicUser(user), verificationRequired: Boolean(verificationToken), verificationUrl });
    response.cookies.set(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_MAX_AGE });
    return response;
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Registration failed." }, { status: 400 });
  }
}

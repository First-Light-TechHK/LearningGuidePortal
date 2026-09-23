import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { emailDeliveryConfigured, sendVerificationEmail, EmailDeliveryError } from "@/services/emailService";
import { requestEmailVerification } from "@/services/productStore";
import { appEnvironment, publicAppOrigin } from "@/services/runtimeConfig";

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    if (!emailDeliveryConfigured()) {
      return NextResponse.json({ ok: false, code: "EMAIL_DELIVERY_NOT_CONFIGURED", message: `Email verification is not configured for ${appEnvironment()}.`, requestId }, { status: 503 });
    }
    const body = await request.json() as { email?: string; locale?: "en-GB" | "zh-CN" };
    const locale = body.locale === "zh-CN" ? "zh-CN" : "en-GB";
    const result = await requestEmailVerification(body.email || "");
    if (!result.accepted) return NextResponse.json({ ok: false, code: result.code === "daily_limit" ? "VERIFICATION_DAILY_LIMIT" : "VERIFICATION_RATE_LIMITED", message: result.code === "daily_limit" ? "The daily verification email limit has been reached." : "Please wait before requesting another verification email.", data: { retryAfter: result.retryAfter }, requestId }, { status: 429 });
    if (result.user && result.token) {
      const verificationUrl = `${publicAppOrigin(request)}/${locale}/portal/verify-email?token=${encodeURIComponent(result.token)}`;
      await sendVerificationEmail({ to: result.user.email, url: verificationUrl, locale });
    }
    return NextResponse.json({ ok: true, data: { accepted: true, retryAfter: result.retryAfter }, requestId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Verification email could not be sent.";
    const tooSoon = message.includes("wait before requesting");
    const delivery = error instanceof EmailDeliveryError || /not authorized|MessageRejected|not verified/i.test(message);
    return NextResponse.json({
      ok: false,
      code: tooSoon ? "VERIFICATION_RATE_LIMITED" : "EMAIL_DELIVERY_FAILED",
      message: delivery ? "Verification email could not be sent. Use a mailbox that this environment is allowed to mail." : message,
      requestId
    }, { status: tooSoon ? 429 : 400 });
  }
}

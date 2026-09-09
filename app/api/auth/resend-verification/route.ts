import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { emailDeliveryConfigured, sendVerificationEmail } from "@/services/emailService";
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
    if (result.user && result.token) {
      const verificationUrl = `${publicAppOrigin(request)}/${locale}/portal/verify-email?token=${encodeURIComponent(result.token)}`;
      await sendVerificationEmail({ to: result.user.email, url: verificationUrl, locale });
    }
    return NextResponse.json({ ok: true, data: { accepted: true }, requestId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Verification email could not be sent.";
    if (message.includes("wait before requesting")) {
      return NextResponse.json({ ok: true, data: { accepted: true }, requestId });
    }
    return NextResponse.json({ ok: false, code: "EMAIL_DELIVERY_FAILED", message, requestId }, { status: 400 });
  }
}

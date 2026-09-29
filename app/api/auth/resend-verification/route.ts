import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { resendVerificationEmail } from "@/services/emailResend";
import { emailDeliveryConfigured } from "@/services/emailService";
import { appEnvironment } from "@/services/runtimeConfig";

export async function POST(request: Request) {
  const requestId = randomUUID();
  if (!emailDeliveryConfigured()) {
    return NextResponse.json({ ok: false, code: "EMAIL_DELIVERY_NOT_CONFIGURED", message: `Email verification is not configured for ${appEnvironment()}.`, requestId }, { status: 503 });
  }
  const body = await request.json() as { email?: string; locale?: "en-GB" | "zh-CN" };
  const locale = body.locale === "zh-CN" ? "zh-CN" : "en-GB";
  const result = await resendVerificationEmail({ email: typeof body.email === "string" ? body.email : "", locale, request });
  if ("limited" in result) {
    return NextResponse.json({ ok: false, code: "VERIFICATION_DAILY_LIMIT", requestId }, { status: 429 });
  }
  return NextResponse.json({ ok: true, data: { accepted: true }, requestId });
}

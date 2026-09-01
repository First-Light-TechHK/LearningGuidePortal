import { NextResponse } from "next/server";
import { requestPasswordReset } from "@/services/productStore";
import { emailDeliveryConfigured, sendPasswordResetEmail } from "@/services/emailService";
import { appEnvironment, appOrigin, isProductionEnvironment } from "@/services/runtimeConfig";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string; locale?: "en-GB" | "zh-CN" };
    if (isProductionEnvironment() && !emailDeliveryConfigured()) return NextResponse.json({ ok: false, error: `Password reset email is not configured for ${appEnvironment()}.` }, { status: 503 });
    const result = await requestPasswordReset(body.email || "");
    const locale = body.locale === "zh-CN" ? "zh-CN" : "en-GB";
    const resetUrl = result.token && !isProductionEnvironment() ? `/${locale}/portal/reset-password?token=${encodeURIComponent(result.token)}` : null;
    if (result.token && isProductionEnvironment()) await sendPasswordResetEmail({ to: body.email?.trim() || "", url: `${appOrigin(request)}/${locale}/portal/reset-password?token=${encodeURIComponent(result.token)}` });
    return NextResponse.json({ ok: true, resetUrl });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Password reset request failed." }, { status: 400 });
  }
}

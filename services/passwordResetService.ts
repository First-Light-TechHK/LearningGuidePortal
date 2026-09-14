import type { PasswordResetRequest, PasswordResetResult } from "@/contracts/passwordReset";
import { requestPasswordReset } from "./productStore";
import { emailDeliveryConfigured, sendPasswordResetEmail } from "./emailService";
import { appEnvironment, publicAppOrigin, safeReturnTo } from "./runtimeConfig";

export async function deliverPasswordReset(input: PasswordResetRequest, request: Request): Promise<PasswordResetResult> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("invalid_request");
  const origin = publicAppOrigin(request);
  if (request.headers.get("origin") && ![origin, new URL(request.url).origin].includes(request.headers.get("origin")!)) throw new Error("invalid_request");
  const configured = emailDeliveryConfigured();
  const preview = appEnvironment() === "DEV" && process.env.LOCAL_PASSWORD_RESET_PREVIEW === "1";
  if (!configured && !preview) throw new Error("email_unavailable");
  const locale = input.locale === "zh-CN" ? "zh-CN" : "en-GB";
  const returnTo = safeReturnTo(input.returnTo, `/${locale}/account/my-learning`);
  const result = await requestPasswordReset(email, true);
  const resetUrl = result.token ? `/${locale}/portal/reset-password?${new URLSearchParams({ token: result.token, returnTo })}` : null;
  if (configured && resetUrl) {
    try { await sendPasswordResetEmail({ to: email, url: origin + resetUrl, locale }); }
    catch { throw new Error("email_unavailable"); }
  }
  return { accepted: true, retryAfter: 60, resetUrl: !configured && preview ? resetUrl : null };
}

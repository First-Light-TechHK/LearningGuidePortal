import type { PasswordResetRequest, PasswordResetResult } from "@/contracts/passwordReset";
import { requestPasswordReset } from "./productStore";
import { emailDeliveryConfigured, sendPasswordResetEmail } from "./emailService";
import { localResetPreviewAllowed, publicAppOrigin, safeReturnTo } from "./runtimeConfig";

export async function deliverPasswordReset(input: PasswordResetRequest, request: Request): Promise<PasswordResetResult> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("invalid_request");
  const configured = emailDeliveryConfigured();
  // Only the explicit localhost preview may proceed without a working mailbox.
  // Every deployed environment must fail visibly instead of claiming it sent.
  const localPreview = localResetPreviewAllowed(request);
  if (!configured && !localPreview) throw new Error("email_unavailable");
  const locale = input.locale === "zh-CN" ? "zh-CN" : "en-GB";
  const returnTo = safeReturnTo(input.returnTo, `/${locale}/account/my-learning`);
  const result = await requestPasswordReset(email, true);
  const resetUrl = result.token ? `/${locale}/portal/reset-password?${new URLSearchParams({ token: result.token, returnTo })}` : null;
  if (configured && resetUrl) {
    let origin: string;
    try {
      origin = publicAppOrigin(request);
    } catch {
      if (!localPreview) throw new Error("email_unavailable");
      return { accepted: true, retryAfter: 60, resetUrl: null };
    }
    if (request.headers.get("origin") && ![origin, new URL(request.url).origin].includes(request.headers.get("origin")!)) throw new Error("invalid_request");
    try { await sendPasswordResetEmail({ to: email, url: origin + resetUrl, locale }); }
    catch {
      if (localPreview) return { accepted: true, retryAfter: 60, resetUrl: null };
      throw new Error("email_unavailable");
    }
  }
  return { accepted: true, retryAfter: 60, resetUrl: null };
}

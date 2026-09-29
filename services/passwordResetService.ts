import { randomBytes } from "crypto";
import type { PasswordResetRequest, PasswordResetResult } from "@/contracts/passwordReset";
import { planPasswordReset, replaceLivePasswordResetToken, requestPasswordReset } from "./productStore";
import { emailDeliveryConfigured, sendPasswordResetEmail } from "./emailService";
import { isManagedEnvironment, publicAppOrigin, safeReturnTo } from "./runtimeConfig";

export async function deliverPasswordReset(input: PasswordResetRequest, request: Request): Promise<PasswordResetResult> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("invalid_request");
  const configured = emailDeliveryConfigured();
  const managed = isManagedEnvironment();
  if (!configured && managed) throw new Error("email_unavailable");
  const accepted: PasswordResetResult = { accepted: true, retryAfter: 60, resetUrl: null };
  if (!configured) {
    await requestPasswordReset(email, true);
    return accepted;
  }
  let origin: string;
  try {
    origin = publicAppOrigin(request);
  } catch {
    if (managed) throw new Error("email_unavailable");
    return accepted;
  }
  if (request.headers.get("origin") && ![origin, new URL(request.url).origin].includes(request.headers.get("origin")!)) throw new Error("invalid_request");
  const target = await planPasswordReset(email);
  if (!target) return accepted;
  const locale = input.locale === "zh-CN" ? "zh-CN" : "en-GB";
  const returnTo = safeReturnTo(input.returnTo, `/${locale}/account/my-learning`);
  const rawToken = randomBytes(32).toString("base64url");
  const resetUrl = `${origin}/${locale}/portal/reset-password?${new URLSearchParams({ token: rawToken, returnTo })}`;
  try {
    await sendPasswordResetEmail({ to: target.email, url: resetUrl, locale });
  } catch {
    return accepted;
  }
  await replaceLivePasswordResetToken(target.userId, rawToken);
  return accepted;
}

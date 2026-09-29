import { randomBytes } from "crypto";
import { sendVerificationEmail } from "./emailService";
import { ensureProductData, replaceLiveVerificationToken } from "./productStore";
import { publicAppOrigin } from "./runtimeConfig";

const VERIFICATION_COOLDOWN_MS = 60_000;

export async function resendVerificationEmail(input: {
  email: string;
  locale: "en-GB" | "zh-CN";
  request: Request;
}): Promise<{ accepted: true } | { limited: "daily" }> {
  const email = input.email.trim().toLowerCase();
  const data = await ensureProductData();
  const user = data.users.find((item) => item.email === email && item.status === "pending");
  if (!user?.email) return { accepted: true };
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const sentToday = data.verificationTokens.filter((item) => item.userId === user.id && new Date(item.createdAt).getTime() >= since).length;
  if (sentToday >= 10) return { limited: "daily" };
  const latest = data.verificationTokens.find((item) => item.userId === user.id);
  if (latest && Date.now() - new Date(latest.createdAt).getTime() < VERIFICATION_COOLDOWN_MS) return { accepted: true };
  const rawToken = randomBytes(32).toString("base64url");
  const verificationUrl = `${publicAppOrigin(input.request)}/${input.locale}/portal/verify-email?token=${encodeURIComponent(rawToken)}`;
  try {
    await sendVerificationEmail({ to: user.email, url: verificationUrl, locale: input.locale });
  } catch {
    return { accepted: true };
  }
  await replaceLiveVerificationToken(user.id, rawToken);
  return { accepted: true };
}

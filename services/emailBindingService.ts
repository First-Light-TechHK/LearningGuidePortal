import { randomBytes } from "crypto";
import type { EmailBindingRequest } from "@/contracts/emailBinding";
import { commitEmailBinding, planEmailBinding } from "./productStore";
import { emailDeliveryConfigured, sendEmailBindingEmail } from "./emailService";
import { publicAppOrigin, safeReturnTo } from "./runtimeConfig";

export async function requestEmailBinding(userId: string, input: EmailBindingRequest, request: Request) {
  if (!emailDeliveryConfigured()) throw new Error("email_unavailable");
  const origin = publicAppOrigin(request);
  if (request.headers.get("origin") && ![origin, new URL(request.url).origin].includes(request.headers.get("origin")!)) throw new Error("unauthorised");
  const locale = input.locale === "zh-CN" ? "zh-CN" : "en-GB";
  const returnTo = safeReturnTo(input.returnTo, `/${locale}/account/my-learning`);
  const { email } = await planEmailBinding(userId, input.email);
  const rawToken = randomBytes(32).toString("base64url");
  const url = `${origin}/${locale}/portal/bind-email/verify?${new URLSearchParams({ token: rawToken, returnTo })}`;
  try { await sendEmailBindingEmail({ to: email, url, locale }); }
  catch { throw new Error("email_unavailable"); }
  await commitEmailBinding(userId, email, rawToken);
  return { accepted: true, retryAfter: 60 };
}

import type { EmailBindingConfirmation, EmailBindingRequest } from "@/contracts/emailBinding";
import { confirmEmailBinding, issueEmailBinding } from "./productStore";
import { SESSION_COOKIE } from "./productAuth";
import { emailDeliveryConfigured, sendEmailBindingEmail } from "./emailService";
import { isTrustedRequestOrigin, publicAppOrigin, safeReturnTo } from "./runtimeConfig";

export async function requestEmailBinding(userId: string, input: EmailBindingRequest, request: Request) {
  if (!emailDeliveryConfigured()) throw new Error("email_unavailable");
  const origin = publicAppOrigin(request);
  if (!isTrustedRequestOrigin(request, origin)) throw new Error("unauthorised");
  const locale = input.locale === "zh-CN" ? "zh-CN" : "en-GB";
  const returnTo = safeReturnTo(input.returnTo, `/${locale}/account/my-learning`);
  const result = await issueEmailBinding(userId, input.email);
  const url = `${origin}/${locale}/portal/bind-email/verify?${new URLSearchParams({ token: result.token, returnTo })}`;
  try { await sendEmailBindingEmail({ to: result.email, url, locale }); }
  catch { throw new Error("email_unavailable"); }
  return { accepted: true, retryAfter: 60 };
}

export async function completeEmailBinding(input: EmailBindingConfirmation, request: Request) {
  if (typeof input.token !== "string" || !input.token || input.token.length > 256 || (input.returnTo !== undefined && typeof input.returnTo !== "string")) throw new Error("invalid_link");
  const origin = publicAppOrigin(request);
  if (!isTrustedRequestOrigin(request, origin)) throw new Error("invalid_link");
  const sessionToken = (request.headers.get("cookie") || "").split(";").map(value => value.trim()).find(value => value.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  const result = await confirmEmailBinding(input.token, { confirmed: input.confirmed, sessionToken });
  const locale = input.locale === "zh-CN" ? "zh-CN" : "en-GB";
  const returnTo = safeReturnTo(input.returnTo, `/${locale}/account/my-learning`);
  return { ...result, continueUrl: result.sameUser ? returnTo : `/api/auth/wechat?${new URLSearchParams({ locale, returnTo })}` };
}

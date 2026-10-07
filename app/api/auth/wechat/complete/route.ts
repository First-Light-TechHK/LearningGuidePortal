import { NextRequest, NextResponse } from "next/server";
import { createSession, getOrCreateSocialUser, ProductAuthError } from "@/services/productStore";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "@/services/productAuth";
import { publicAppOrigin, secureAuthCookie } from "@/services/runtimeConfig";
import { handoffSecret, readHandoffCookie, WECHAT_HANDOFF_COOKIE, wechatAuthOrigin, wechatEnvironment, wechatHandoffEnabled } from "@/services/wechatHandoff";
import type { WeChatProfile } from "@/contracts/wechat";

export async function GET(request: NextRequest) {
  if (!wechatHandoffEnabled()) return new NextResponse("Not Found", { status: 404 });
  const origin = publicAppOrigin(request);
  const cookie = readHandoffCookie(request.cookies.get(WECHAT_HANDOFF_COOKIE)?.value);
  const locale = cookie?.returnTo.startsWith("/zh-CN/") ? "zh-CN" : "en-GB";
  const failure = (code: string) => {
    const target = new URL(`/${locale}/portal/sign-in`, origin);
    target.searchParams.set("oauthError", code);
    if (cookie) target.searchParams.set("returnTo", cookie.returnTo);
    const response = NextResponse.redirect(target, 303);
    response.cookies.set(WECHAT_HANDOFF_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: secureAuthCookie(request), path: "/api/auth/wechat", maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  };
  const ticket = new URL(request.url).searchParams.get("ticket");
  const providerError = new URL(request.url).searchParams.get("oauthError");
  if (!cookie || !ticket) return failure(providerError && ["cancelled", "wechat", "state"].includes(providerError) ? providerError : "state");
  try {
    const env = wechatEnvironment();
    const response = await fetch(new URL("/api/auth/wechat/redeem", wechatAuthOrigin()), {
      method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json", "x-wechat-environment": env, authorization: `Bearer ${handoffSecret(env)}` },
      body: JSON.stringify({ ticket }),
    });
    if (!response.ok) return failure("state");
    const body = await response.json() as { result?: { nonce?: string; profile?: WeChatProfile } };
    const result = body.result;
    if (!result || result.nonce !== cookie.nonce || !result.profile?.appId || !result.profile?.openId
      || result.profile.subject !== `${result.profile.appId}:${result.profile.openId}`) return failure("state");
    const user = await getOrCreateSocialUser({ provider: "wechat", providerSubject: result.profile.subject, nickname: result.profile.nickname, locale, wechat: result.profile });
    const session = await createSession(user.id);
    const destination = !user.email || !user.emailVerifiedAt ? `/${locale}/portal/bind-email?returnTo=${encodeURIComponent(cookie.returnTo)}` : cookie.returnTo;
    const completed = NextResponse.redirect(new URL(destination, origin), 303);
    completed.cookies.set(WECHAT_HANDOFF_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: secureAuthCookie(request), path: "/api/auth/wechat", maxAge: 0 });
    completed.cookies.set(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", secure: secureAuthCookie(request), path: "/", maxAge: SESSION_MAX_AGE });
    completed.headers.set("Cache-Control", "no-store");
    completed.headers.set("Referrer-Policy", "no-referrer");
    return completed;
  } catch (error) { return failure(error instanceof ProductAuthError && error.code === "account_conflict" ? "wechat-conflict" : "wechat"); }
}

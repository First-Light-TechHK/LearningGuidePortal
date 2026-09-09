import { NextRequest, NextResponse } from "next/server";
import { ProductAuthError } from "@/services/productStore";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "@/services/productAuth";
import { publicAppOrigin, safeReturnTo, secureAuthCookie } from "@/services/runtimeConfig";
import { OAUTH_STATE_COOKIE, readOAuthState } from "@/services/oauthService";
import { signInWithWeChat, WeChatOAuthError } from "@/services/wechatOAuthService";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const state = readOAuthState(request.cookies.get(OAUTH_STATE_COOKIE)?.value, url.searchParams.get("state"), "wechat");
  const origin = publicAppOrigin(request);
  const secure = secureAuthCookie(request);
  const locale = state?.locale || "en-GB";
  const returnTo = safeReturnTo(state?.returnTo, `/${locale}/account/my-learning`);
  function redirect(target: URL) {
    const response = NextResponse.redirect(target, 303);
    response.cookies.set(OAUTH_STATE_COOKIE, "", { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
  function failure(code: string) {
    const target = new URL(`/${locale}/portal/sign-in`, origin);
    target.search = new URLSearchParams({ oauthError: code, returnTo }).toString();
    return redirect(target);
  }
  if (!state) return failure("state");
  try {
    const code = url.searchParams.get("code");
    if (!code || url.searchParams.has("error")) throw new WeChatOAuthError("cancelled");
    const session = await signInWithWeChat(code, locale);
    const response = redirect(new URL(returnTo, origin));
    response.cookies.set(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: SESSION_MAX_AGE });
    return response;
  } catch (error) {
    const code = error instanceof ProductAuthError
      ? error.code === "account_conflict" ? "wechat-conflict" : "disabled"
      : error instanceof WeChatOAuthError && error.code === "cancelled" ? "cancelled" : "wechat";
    return failure(code);
  }
}

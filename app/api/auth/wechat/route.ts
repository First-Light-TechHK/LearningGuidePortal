import { secureAuthCookie } from "@/services/runtimeConfig";
import { redirectToOAuthOrigin } from "@/services/oauthOrigin";
import { NextResponse } from "next/server";
import { localeFrom } from "@/lib/i18n/config";
import { createSession, getOrCreateSocialUser } from "@/services/productStore";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "@/services/productAuth";
import { publicAppOrigin, safeReturnTo } from "@/services/runtimeConfig";
import { localSocialLoginEnabled, localSocialProfile, makeOAuthState, OAUTH_STATE_COOKIE, wechatConfigured } from "@/services/oauthService";

export async function GET(request: Request) {
  const originRedirect = redirectToOAuthOrigin(request);
  if (originRedirect) return originRedirect;
  const url = new URL(request.url);
  const locale = localeFrom(url.searchParams.get("locale") || "en-GB");
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"), `/${locale}/account/my-learning`);
  if (!wechatConfigured()) {
    if (!localSocialLoginEnabled()) return NextResponse.json({ ok: false, error: "WeChat sign-in is not configured." }, { status: 503 });
    try {
      const profile = localSocialProfile("wechat");
      const user = await getOrCreateSocialUser({ provider: "wechat", providerSubject: profile.subject, email: null, nickname: profile.nickname, locale });
      const session = await createSession(user.id);
      const response = NextResponse.redirect(new URL(returnTo, publicAppOrigin(request)));
      response.cookies.set(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", secure: secureAuthCookie(request), path: "/", maxAge: SESSION_MAX_AGE });
      return response;
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Local WeChat sign-in failed." }, { status: 400 });
    }
  }
  try {
    const state = makeOAuthState(locale, returnTo, "wechat");
    const callback = `${publicAppOrigin(request)}/api/auth/wechat/callback`;
    const wechatUrl = new URL("https://open.weixin.qq.com/connect/qrconnect");
    wechatUrl.search = new URLSearchParams({ appid: process.env.WECHAT_APP_ID!.trim(), redirect_uri: callback, response_type: "code", scope: "snsapi_login", state: state.state }).toString();
    const response = NextResponse.redirect(`${wechatUrl}#wechat_redirect`);
    response.cookies.set(OAUTH_STATE_COOKIE, state.cookieValue, { httpOnly: true, sameSite: "lax", secure: secureAuthCookie(request), path: "/", maxAge: 600 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "WeChat sign-in is not ready." }, { status: 503 });
  }
}

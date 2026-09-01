import { NextResponse } from "next/server";
import { localeFrom } from "@/lib/i18n/config";
import { appOrigin, safeReturnTo } from "@/services/runtimeConfig";
import { makeOAuthState, OAUTH_STATE_COOKIE, wechatConfigured } from "@/services/oauthService";

export async function GET(request: Request) {
  if (!wechatConfigured()) return NextResponse.json({ ok: false, error: "WeChat sign-in is not configured." }, { status: 503 });
  const url = new URL(request.url);
  const locale = localeFrom(url.searchParams.get("locale") || "en-GB");
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"), `/${locale}/account/my-learning`);
  const state = makeOAuthState(locale, returnTo);
  const callback = `${appOrigin(request)}/api/auth/wechat/callback`;
  const wechatUrl = new URL("https://open.weixin.qq.com/connect/qrconnect");
  wechatUrl.search = new URLSearchParams({ appid: process.env.WECHAT_APP_ID as string, redirect_uri: callback, response_type: "code", scope: "snsapi_login", state: state.nonce }).toString();
  const response = NextResponse.redirect(`${wechatUrl}#wechat_redirect`);
  response.cookies.set(OAUTH_STATE_COOKIE, state.cookieValue, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  return response;
}

import { secureAuthCookie } from "@/services/runtimeConfig";
import { redirectToOAuthOrigin } from "@/services/oauthOrigin";
import { NextResponse } from "next/server";
import { localeFrom } from "@/lib/i18n/config";
import { createSession, getOrCreateSocialUser } from "@/services/productStore";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "@/services/productAuth";
import { publicAppOrigin, safeReturnTo } from "@/services/runtimeConfig";
import { localSocialLoginEnabled, localSocialProfile, makeOAuthState, OAUTH_STATE_COOKIE, wechatConfigured } from "@/services/oauthService";
import { isWechatAuthHost, makeCentralRequest, makeHandoffCookie, readCentralRequest, WECHAT_HANDOFF_COOKIE, wechatAuthOrigin, wechatEnvironment, wechatHandoffEnabled } from "@/services/wechatHandoff";

export async function GET(request: Request) {
  if (wechatHandoffEnabled()) {
    const url = new URL(request.url);
    const locale = localeFrom(url.searchParams.get("locale") || "en-GB");
    const returnTo = safeReturnTo(url.searchParams.get("returnTo"), `/${locale}/account/my-learning`);
    if (!isWechatAuthHost(request)) {
      const canonicalRedirect = redirectToOAuthOrigin(request);
      if (canonicalRedirect) return canonicalRedirect;
      try {
        const env = wechatEnvironment();
        const handoff = makeHandoffCookie(returnTo);
        const target = new URL("/api/auth/wechat", wechatAuthOrigin());
        target.searchParams.set("request", makeCentralRequest(env, handoff.nonce, returnTo));
        target.searchParams.set("locale", locale);
        const response = NextResponse.redirect(target, 303);
        response.cookies.set(WECHAT_HANDOFF_COOKIE, handoff.value, { httpOnly: true, sameSite: "lax", secure: secureAuthCookie(request), path: "/api/auth/wechat", maxAge: 600 });
        response.headers.set("Cache-Control", "no-store");
        response.headers.set("Referrer-Policy", "no-referrer");
        return response;
      } catch { return NextResponse.json({ ok: false, code: "WECHAT_NOT_READY" }, { status: 503 }); }
    }
    try {
      const central = readCentralRequest(url.searchParams.get("request"));
      const env = central?.env || wechatEnvironment();
      const nonce = central?.nonce;
      if (url.searchParams.has("request") && !central) return NextResponse.json({ ok: false, code: "WECHAT_INVALID_REQUEST" }, { status: 400 });
      if (!wechatConfigured()) return NextResponse.json({ ok: false, code: "WECHAT_NOT_CONFIGURED" }, { status: 503 });
      const state = makeOAuthState(locale, central?.returnTo || returnTo, "wechat", nonce ? { env, nonce } : undefined);
      const callback = `${wechatAuthOrigin()}/api/auth/wechat/callback`;
      const wechatUrl = new URL("https://open.weixin.qq.com/connect/qrconnect");
      wechatUrl.search = new URLSearchParams({ appid: process.env.WECHAT_APP_ID!.trim(), redirect_uri: callback, response_type: "code", scope: "snsapi_login", state: state.state }).toString();
      const response = NextResponse.redirect(`${wechatUrl}#wechat_redirect`);
      response.cookies.set(OAUTH_STATE_COOKIE, state.cookieValue, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 600 });
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
      return response;
    } catch { return NextResponse.json({ ok: false, code: "WECHAT_NOT_READY" }, { status: 503 }); }
  }
  const originRedirect = redirectToOAuthOrigin(request);
  if (originRedirect) return originRedirect;
  const url = new URL(request.url);
  const locale = localeFrom(url.searchParams.get("locale") || "en-GB");
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"), `/${locale}/account/my-learning`);
  if (!wechatConfigured()) {
    if (!localSocialLoginEnabled()) return NextResponse.json({ ok: false, code: "WECHAT_NOT_CONFIGURED" }, { status: 503 });
    try {
      const profile = localSocialProfile("wechat");
      const user = await getOrCreateSocialUser({ provider: "wechat", providerSubject: profile.subject, email: null, nickname: profile.nickname, locale });
      const session = await createSession(user.id);
      const destination = !user.email || !user.emailVerifiedAt ? `/${locale}/portal/bind-email?returnTo=${encodeURIComponent(returnTo)}` : returnTo;
      const response = NextResponse.redirect(new URL(destination, publicAppOrigin(request)));
      response.cookies.set(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", secure: secureAuthCookie(request), path: "/", maxAge: SESSION_MAX_AGE });
      return response;
    } catch {
      return NextResponse.json({ ok: false, code: "LOCAL_WECHAT_FAILED" }, { status: 400 });
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
  } catch {
    return NextResponse.json({ ok: false, code: "WECHAT_NOT_READY" }, { status: 503 });
  }
}

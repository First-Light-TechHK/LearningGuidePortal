import { secureAuthCookie } from "@/services/runtimeConfig";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { localeFrom } from "@/lib/i18n/config";
import { createSession, getOrCreateSocialUser } from "@/services/productStore";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "@/services/productAuth";
import { publicAppOrigin, safeReturnTo } from "@/services/runtimeConfig";
import { googleConfigured, localSocialLoginEnabled, localSocialProfile, makeOAuthState, OAUTH_STATE_COOKIE } from "@/services/oauthService";

export async function GET(request: Request) {
  const requestId = randomUUID();
  const url = new URL(request.url);
  const locale = localeFrom(url.searchParams.get("locale") || "en-GB");
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"), `/${locale}/account/my-learning`);
  if (!googleConfigured()) {
    if (!localSocialLoginEnabled()) return NextResponse.json({ ok: false, code: "GOOGLE_NOT_CONFIGURED", message: "Google sign-in is not configured.", requestId }, { status: 503 });
    try {
      const profile = localSocialProfile("google");
      const user = await getOrCreateSocialUser({ provider: "google", providerSubject: profile.subject, email: profile.email, nickname: profile.nickname, locale });
      const session = await createSession(user.id);
      const response = NextResponse.redirect(new URL(returnTo, publicAppOrigin(request)));
      response.cookies.set(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", secure: secureAuthCookie(request), path: "/", maxAge: SESSION_MAX_AGE });
      return response;
    } catch (error) {
      return NextResponse.json({ ok: false, code: "LOCAL_GOOGLE_FAILED", message: error instanceof Error ? error.message : "Local Google sign-in failed.", requestId }, { status: 400 });
    }
  }
  try {
    const state = makeOAuthState(locale, returnTo, "google");
    const callback = `${publicAppOrigin(request)}/api/auth/google/callback`;
    const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleUrl.search = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID as string, redirect_uri: callback, response_type: "code", scope: "openid email profile", state: state.state, nonce: state.nonce, code_challenge: state.codeChallenge, code_challenge_method: "S256", access_type: "online", prompt: "select_account" }).toString();
    const response = NextResponse.redirect(googleUrl);
    response.cookies.set(OAUTH_STATE_COOKIE, state.cookieValue, { httpOnly: true, sameSite: "lax", secure: secureAuthCookie(request), path: "/", maxAge: 600 });
    return response;
  } catch (error) {
    console.warn("Google OAuth start failed", { requestId, error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, code: "GOOGLE_NOT_READY", message: "Google sign-in is not ready.", requestId }, { status: 503 });
  }
}

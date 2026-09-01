import { NextResponse } from "next/server";
import { localeFrom } from "@/lib/i18n/config";
import { appOrigin, safeReturnTo } from "@/services/runtimeConfig";
import { googleConfigured, makeOAuthState, OAUTH_STATE_COOKIE } from "@/services/oauthService";

export async function GET(request: Request) {
  if (!googleConfigured()) return NextResponse.json({ ok: false, error: "Google sign-in is not configured." }, { status: 503 });
  const url = new URL(request.url);
  const locale = localeFrom(url.searchParams.get("locale") || "en-GB");
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"), `/${locale}/account/my-learning`);
  const state = makeOAuthState(locale, returnTo);
  const callback = `${appOrigin(request)}/api/auth/google/callback`;
  const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleUrl.search = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID as string, redirect_uri: callback, response_type: "code", scope: "openid email profile", state: state.nonce, access_type: "online", prompt: "select_account" }).toString();
  const response = NextResponse.redirect(googleUrl);
  response.cookies.set(OAUTH_STATE_COOKIE, state.cookieValue, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  return response;
}

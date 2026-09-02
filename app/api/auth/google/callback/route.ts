import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSession, getOrCreateSocialUser, ProductAuthError } from "@/services/productStore";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "@/services/productAuth";
import { publicAppOrigin, safeReturnTo } from "@/services/runtimeConfig";
import { fetchGoogleProfile, GoogleOAuthError, OAUTH_STATE_COOKIE, readOAuthState } from "@/services/oauthService";

function clearOAuthCookie(response: NextResponse) {
  response.cookies.set(OAUTH_STATE_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}

export async function GET(request: Request) {
  const requestId = randomUUID();
  const url = new URL(request.url);
  const state = readOAuthState((await cookies()).get(OAUTH_STATE_COOKIE)?.value, url.searchParams.get("state"), "google");
  const origin = publicAppOrigin(request);
  if (!state) return clearOAuthCookie(NextResponse.redirect(new URL("/en-GB/portal/sign-in?oauthError=state", origin), 303));
  const returnTo = safeReturnTo(state.returnTo, `/${state.locale}/account/my-learning`);
  try {
    if (url.searchParams.get("error")) throw new GoogleOAuthError("exchange");
    const code = url.searchParams.get("code");
    if (!code) throw new GoogleOAuthError("exchange");
    const profile = await fetchGoogleProfile(code, `${origin}/api/auth/google/callback`, state);
    const user = await getOrCreateSocialUser({ provider: "google", providerSubject: profile.subject, email: profile.email, nickname: profile.nickname, locale: state.locale });
    const session = await createSession(user.id);
    const response = NextResponse.redirect(new URL(returnTo, origin), 303);
    response.cookies.set(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_MAX_AGE });
    return clearOAuthCookie(response);
  } catch (error) {
    const oauthError = error instanceof ProductAuthError
      ? error.code === "account_conflict" ? "account-conflict" : error.code === "account_disabled" ? "disabled" : "account"
      : error instanceof GoogleOAuthError && error.code === "email" ? "email" : "google";
    console.warn("Google OAuth callback failed", { requestId, code: error instanceof ProductAuthError || error instanceof GoogleOAuthError ? error.code : "unknown" });
    return clearOAuthCookie(NextResponse.redirect(new URL(`/${state.locale}/portal/sign-in?oauthError=${oauthError}`, origin), 303));
  }
}

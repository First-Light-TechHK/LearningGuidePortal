import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSession, getOrCreateSocialUser } from "@/services/productStore";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "@/services/productAuth";
import { appOrigin, safeReturnTo } from "@/services/runtimeConfig";
import { fetchGoogleProfile, OAUTH_STATE_COOKIE, readOAuthState } from "@/services/oauthService";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = readOAuthState((await cookies()).get(OAUTH_STATE_COOKIE)?.value, url.searchParams.get("state"));
  const origin = appOrigin(request);
  if (!state) return NextResponse.redirect(new URL("/en-GB/portal/sign-in?oauthError=state", origin));
  const returnTo = safeReturnTo(state.returnTo, `/${state.locale}/account/my-learning`);
  const response = NextResponse.redirect(new URL(returnTo, origin));
  response.cookies.set(OAUTH_STATE_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  try {
    const code = url.searchParams.get("code");
    if (!code) throw new Error("Google sign-in was cancelled.");
    const profile = await fetchGoogleProfile(code, `${origin}/api/auth/google/callback`);
    const user = await getOrCreateSocialUser({ provider: "google", providerSubject: profile.subject, email: profile.email, nickname: profile.nickname, locale: state.locale });
    const session = await createSession(user.id);
    response.cookies.set(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_MAX_AGE });
    return response;
  } catch {
    return NextResponse.redirect(new URL(`/${state.locale}/portal/sign-in?oauthError=google`, origin));
  }
}

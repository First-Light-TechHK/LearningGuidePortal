import { secureAuthCookie } from "@/services/runtimeConfig";
import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSession, getActiveUserByEmail, getOrCreateSocialUser, linkSocialProvider, ProductAuthError } from "@/services/productStore";
import { currentProductUser, SESSION_COOKIE, SESSION_MAX_AGE } from "@/services/productAuth";
import { publicAppOrigin, safeReturnTo } from "@/services/runtimeConfig";
import { fetchGoogleProfile, GoogleOAuthError, OAUTH_STATE_COOKIE, readOAuthState } from "@/services/oauthService";

function clearOAuthCookie(response: NextResponse, request: Request) {
  response.cookies.set(OAUTH_STATE_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: secureAuthCookie(request), path: "/", maxAge: 0 });
  return response;
}

async function finishWithSession(request: Request, origin: string, returnTo: string, userId: string) {
  const session = await createSession(userId);
  const response = NextResponse.redirect(new URL(returnTo, origin), 303);
  response.cookies.set(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", secure: secureAuthCookie(request), path: "/", maxAge: SESSION_MAX_AGE });
  return clearOAuthCookie(response, request);
}

export async function GET(request: Request) {
  const requestId = randomUUID();
  const url = new URL(request.url);
  const state = readOAuthState((await cookies()).get(OAUTH_STATE_COOKIE)?.value, url.searchParams.get("state"), "google");
  const origin = publicAppOrigin(request);
  if (!state) return clearOAuthCookie(NextResponse.redirect(new URL("/en-GB/portal/sign-in?oauthError=state", origin), 303), request);
  const returnTo = safeReturnTo(state.returnTo, `/${state.locale}/account/my-learning`);
  let profile: { subject: string; email: string; nickname?: string } | null = null;
  try {
    if (url.searchParams.get("error")) throw new GoogleOAuthError("exchange");
    const code = url.searchParams.get("code");
    if (!code) throw new GoogleOAuthError("exchange");
    profile = await fetchGoogleProfile(code, `${origin}/api/auth/google/callback`, state);
    const user = await getOrCreateSocialUser({ provider: "google", providerSubject: profile.subject, email: profile.email, nickname: profile.nickname, locale: state.locale });
    return await finishWithSession(request, origin, returnTo, user.id);
  } catch (error) {
    // A Google identity whose email matches an existing password account can be
    // linked when the browser already holds a session for that same account.
    if (error instanceof ProductAuthError && error.code === "account_conflict" && profile) {
      try {
        const sessionUser = await currentProductUser();
        if (sessionUser && sessionUser.email === profile.email) {
          const linkedUser = await linkSocialProvider({ userId: sessionUser.id, provider: "google", providerSubject: profile.subject, email: profile.email });
          return await finishWithSession(request, origin, returnTo, linkedUser.id);
        }
        // Google has already verified this email. If the existing account has
        // also verified it, signing in and linking the Google identity is safe
        // and avoids trapping users who first registered with email/password.
        const existingUser = await getActiveUserByEmail(profile.email);
        if (existingUser?.emailVerifiedAt) {
          const linkedUser = await linkSocialProvider({ userId: existingUser.id, provider: "google", providerSubject: profile.subject, email: profile.email });
          return await finishWithSession(request, origin, returnTo, linkedUser.id);
        }
      } catch (linkError) {
        console.warn("Google OAuth link failed", { requestId, code: linkError instanceof ProductAuthError ? linkError.code : "unknown" });
      }
    }
    const oauthError = error instanceof ProductAuthError
      ? error.code === "account_conflict" ? "account-conflict" : error.code === "account_disabled" ? "disabled" : "account"
      : error instanceof GoogleOAuthError && error.code === "email" ? "email" : "google";
    console.warn("Google OAuth callback failed", { requestId, code: error instanceof ProductAuthError || error instanceof GoogleOAuthError ? error.code : "unknown" });
    return clearOAuthCookie(NextResponse.redirect(new URL(`/${state.locale}/portal/sign-in?oauthError=${oauthError}`, origin), 303), request);
  }
}

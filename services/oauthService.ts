import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { OAuth2Client } from "google-auth-library";
import { localeFrom, type Locale } from "@/lib/i18n/config";
import { isProductionEnvironment } from "./runtimeConfig";

export const OAUTH_STATE_COOKIE = "learning_guide_oauth_state";
const OAUTH_TRANSACTION_SECONDS = 10 * 60;

export class GoogleOAuthError extends Error {
  constructor(public readonly code: "configuration" | "state" | "exchange" | "token" | "email") {
    super(code);
  }
}

function googleExchangeDiagnostic(error: unknown) {
  const value = error && typeof error === "object" ? error as {
    code?: unknown;
    response?: { status?: unknown; data?: unknown };
  } : undefined;
  const data = value?.response?.data && typeof value.response.data === "object"
    ? value.response.data as { error?: unknown; error_description?: unknown }
    : undefined;

  return {
    status: typeof value?.response?.status === "number" ? value.response.status : undefined,
    providerError: typeof data?.error === "string" ? data.error.slice(0, 100) : undefined,
    description: typeof data?.error_description === "string" ? data.error_description.slice(0, 300) : undefined,
    transportCode: typeof value?.code === "string" ? value.code.slice(0, 100) : undefined,
  };
}

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export function wechatConfigured() {
  return Boolean(process.env.WECHAT_APP_ID?.trim() && process.env.WECHAT_APP_SECRET?.trim());
}

export function localSocialLoginEnabled() {
  return !isProductionEnvironment() && process.env.LOCAL_SOCIAL_LOGIN !== "0";
}

export function googleEnabled() {
  return googleConfigured() || localSocialLoginEnabled();
}

export function wechatEnabled() {
  return wechatConfigured() || localSocialLoginEnabled();
}

export function localSocialProfile(provider: "google" | "wechat") {
  return provider === "google"
    ? { subject: "local-google-user", email: "google.local@example.test", nickname: "Google Learner" }
    : { subject: "local-wechat-user", email: "wechat.local@example.test", nickname: "WeChat Learner" };
}

function oauthSigningSecret() {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) throw new GoogleOAuthError("configuration");
  return secret;
}

function signPayload(payload: string) {
  return createHmac("sha256", oauthSigningSecret()).update(payload).digest("base64url");
}

export function makeOAuthState(localeValue: string, returnTo: string, provider: "google" | "wechat" = "google") {
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const locale: Locale = localeFrom(localeValue);
  const expiresAt = Date.now() + OAUTH_TRANSACTION_SECONDS * 1000;
  const payload = Buffer.from(JSON.stringify({ provider, state, nonce, codeVerifier, locale, returnTo, expiresAt }), "utf8").toString("base64url");
  return { state, nonce, codeChallenge, cookieValue: `${payload}.${signPayload(payload)}` };
}

export function readOAuthState(value: string | undefined, state: string | null, provider: "google" | "wechat" = "google") {
  if (!value || !state) return null;
  try {
    const [encoded, signature] = value.split(".");
    if (!encoded || !signature) return null;
    const expected = Buffer.from(signPayload(encoded), "utf8");
    const actual = Buffer.from(signature, "utf8");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { provider?: string; state?: string; nonce?: string; codeVerifier?: string; locale?: string; returnTo?: string; expiresAt?: number };
    if (payload.provider !== provider || !payload.state || payload.state !== state || !payload.nonce || !payload.codeVerifier || !payload.expiresAt || payload.expiresAt <= Date.now()) return null;
    const locale = localeFrom(payload.locale);
    return { locale, returnTo: payload.returnTo || `/${locale}/account/my-learning`, nonce: payload.nonce, codeVerifier: payload.codeVerifier };
  } catch {
    return null;
  }
}

export async function fetchGoogleProfile(code: string, redirectUri: string, transaction: { nonce: string; codeVerifier: string }) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new GoogleOAuthError("configuration");
  const client = new OAuth2Client(clientId, clientSecret, redirectUri);
  let idToken: string | null | undefined;
  try {
    const result = await client.getToken({ code, codeVerifier: transaction.codeVerifier, redirect_uri: redirectUri });
    idToken = result.tokens.id_token;
  } catch (error) {
    // Keep OAuth codes, tokens and client credentials out of logs. These fields
    // are sufficient to distinguish provider rejection from transport failures.
    console.warn("Google token exchange failed", googleExchangeDiagnostic(error));
    throw new GoogleOAuthError("exchange");
  }
  if (!idToken) throw new GoogleOAuthError("token");
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    const profile = ticket.getPayload();
    if (!profile?.sub || !profile.email || profile.email_verified !== true) throw new GoogleOAuthError("email");
    if (!profile.nonce || profile.nonce !== transaction.nonce) throw new GoogleOAuthError("token");
    return { subject: profile.sub, email: profile.email.trim().toLowerCase(), nickname: profile.name?.trim() || undefined };
  } catch (error) {
    if (error instanceof GoogleOAuthError) throw error;
    throw new GoogleOAuthError("token");
  }
}

export async function fetchWeChatProfile(code: string) {
  const appId = process.env.WECHAT_APP_ID?.trim();
  const appSecret = process.env.WECHAT_APP_SECRET?.trim();
  if (!appId || !appSecret) throw new Error("WeChat sign-in is not configured.");
  const tokenUrl = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
  tokenUrl.search = new URLSearchParams({ appid: appId, secret: appSecret, code, grant_type: "authorization_code" }).toString();
  const tokenResponse = await fetch(tokenUrl);
  const token = await tokenResponse.json() as { access_token?: string; openid?: string; unionid?: string; errcode?: number };
  if (!tokenResponse.ok || !token.access_token || !token.openid) throw new Error("WeChat sign-in could not be completed.");
  const profileUrl = new URL("https://api.weixin.qq.com/sns/userinfo");
  profileUrl.search = new URLSearchParams({ access_token: token.access_token, openid: token.openid, lang: "en" }).toString();
  const profileResponse = await fetch(profileUrl);
  const profile = await profileResponse.json() as { nickname?: string; unionid?: string; openid?: string; errcode?: number };
  if (!profileResponse.ok || profile.errcode || !profile.openid) throw new Error("WeChat profile could not be read.");
  return { subject: profile.unionid || token.unionid || profile.openid, email: `wechat-${profile.unionid || token.unionid || profile.openid}@local.invalid`, nickname: profile.nickname };
}

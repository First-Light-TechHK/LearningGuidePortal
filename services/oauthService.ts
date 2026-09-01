import { randomBytes } from "crypto";
import { localeFrom, type Locale } from "@/lib/i18n/config";

export const OAUTH_STATE_COOKIE = "learning_guide_oauth_state";

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export function wechatConfigured() {
  return Boolean(process.env.WECHAT_APP_ID?.trim() && process.env.WECHAT_APP_SECRET?.trim());
}

export function makeOAuthState(localeValue: string, returnTo: string) {
  const nonce = randomBytes(24).toString("base64url");
  const locale: Locale = localeFrom(localeValue);
  const payload = Buffer.from(JSON.stringify({ nonce, locale, returnTo }), "utf8").toString("base64url");
  return { nonce, cookieValue: payload };
}

export function readOAuthState(value: string | undefined, state: string | null) {
  if (!value || !state) return null;
  try {
    const payload = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { nonce?: string; locale?: string; returnTo?: string };
    if (!payload.nonce || payload.nonce !== state) return null;
    return { locale: localeFrom(payload.locale), returnTo: payload.returnTo || `/${localeFrom(payload.locale)}/account/my-learning` };
  } catch {
    return null;
  }
}

export async function fetchGoogleProfile(code: string, redirectUri: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("Google sign-in is not configured.");
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }) });
  if (!tokenResponse.ok) throw new Error("Google sign-in could not be completed.");
  const token = await tokenResponse.json() as { access_token?: string };
  if (!token.access_token) throw new Error("Google did not return an access token.");
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` } });
  if (!profileResponse.ok) throw new Error("Google profile could not be read.");
  const profile = await profileResponse.json() as { sub?: string; email?: string; email_verified?: boolean; name?: string };
  if (!profile.sub || !profile.email || profile.email_verified === false) throw new Error("Google did not return a verified email address.");
  return { subject: profile.sub, email: profile.email, nickname: profile.name };
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

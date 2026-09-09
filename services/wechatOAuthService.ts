import type { WeChatProfile } from "@/contracts/wechat";
import { createSession, getOrCreateSocialUser } from "./productStore";
import type { Locale } from "@/lib/i18n/config";

export class WeChatOAuthError extends Error {
  constructor(public readonly code: "configuration" | "cancelled" | "exchange" | "profile") { super(code); }
}

async function providerRequest(url: URL, stage: "exchange" | "profile"): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000), redirect: "error" });
    const body: unknown = await response.json();
    if (!response.ok || !body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    const data = body as Record<string, unknown>;
    if (data.errcode !== undefined && data.errcode !== 0) throw new Error();
    return data;
  } catch {
    // Fetch error URLs may contain credentials. Only expose a bounded stage code.
    throw new WeChatOAuthError(stage);
  }
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value);
}
export async function fetchWeChatProfile(code: string): Promise<WeChatProfile> {
  const appId = process.env.WECHAT_APP_ID?.trim();
  const secret = process.env.WECHAT_APP_SECRET?.trim();
  if (!appId || !identifier(appId) || !secret) throw new WeChatOAuthError("configuration");
  if (!code.trim()) throw new WeChatOAuthError("cancelled");
  const tokenUrl = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
  tokenUrl.search = new URLSearchParams({ appid: appId, secret, code, grant_type: "authorization_code" }).toString();
  const token = await providerRequest(tokenUrl, "exchange");
  if (typeof token.access_token !== "string" || !token.access_token || !identifier(token.openid)) throw new WeChatOAuthError("exchange");
  const profileUrl = new URL("https://api.weixin.qq.com/sns/userinfo");
  profileUrl.search = new URLSearchParams({ access_token: token.access_token, openid: token.openid, lang: "en" }).toString();
  const profile = await providerRequest(profileUrl, "profile");
  if (profile.openid !== token.openid) throw new WeChatOAuthError("profile");
  for (const unionId of [token.unionid, profile.unionid]) {
    if (unionId !== undefined && !identifier(unionId)) throw new WeChatOAuthError("profile");
  }
  if (token.unionid && profile.unionid && token.unionid !== profile.unionid) throw new WeChatOAuthError("profile");
  return { appId, openId: token.openid, subject: `${appId}:${token.openid}`, email: null,
    unionId: (profile.unionid || token.unionid) as string | undefined,
    nickname: typeof profile.nickname === "string" ? profile.nickname : undefined };
}
export async function signInWithWeChat(code: string, locale: Locale) {
  const profile = await fetchWeChatProfile(code);
  const user = await getOrCreateSocialUser({ provider: "wechat", providerSubject: profile.subject,
    nickname: profile.nickname, locale, wechat: profile });
  return createSession(user.id);
}

import type { Locale } from "@/lib/i18n/config";

/** Trusted server-side provider result; never accept this shape from a browser. */
export type WeChatProfile = {
  appId: string;
  openId: string;
  unionId?: string;
  subject: string;
  email: null;
  nickname?: string;
};

export type SocialUserInput = {
  provider: "google" | "wechat";
  providerSubject: string;
  email?: string | null;
  nickname?: string;
  locale?: Locale;
  wechat?: Pick<WeChatProfile, "appId" | "openId" | "unionId">;
};

import enGB from "@/messages/en-GB.json";
import zhCN from "@/messages/zh-CN.json";
import type { Locale } from "./config";

export const messages = {
  "en-GB": enGB,
  "zh-CN": zhCN
} as const;

export function getMessages(locale: Locale) {
  return messages[locale];
}

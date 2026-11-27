import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

const categoryKeys = { science: "science", "chinese humanities": "chinese", "european humanities": "european" } as const;
export function subscriptionCategoryLabel(name: string, locale: Locale) {
  if (["society", "社会"].includes(name.trim().toLowerCase())) return locale === "zh-CN" ? "社会" : "Society";
  const key = categoryKeys[name.trim().toLowerCase() as keyof typeof categoryKeys];
  return key ? getMessages(locale).overviewV1.categories[key] : name;
}

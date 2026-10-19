import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

const categoryKeys = { science: "science", "chinese humanities": "chinese", "european humanities": "european" } as const;
export function subscriptionCategoryLabel(name: string, locale: Locale) {
  const key = categoryKeys[name.trim().toLowerCase() as keyof typeof categoryKeys];
  return key ? getMessages(locale).overviewV1.categories[key] : name;
}

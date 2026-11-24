import type { Locale } from "@/lib/i18n/config";

export function subscriptionOrdersPath(locale: Locale, orderId?: string) {
  const path = `/${locale}/account/my-learning/subscription/orders`;
  return orderId ? `${path}?orderId=${encodeURIComponent(orderId)}` : path;
}

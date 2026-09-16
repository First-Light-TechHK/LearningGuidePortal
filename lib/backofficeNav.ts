import type { Locale } from "@/lib/i18n/config";

export type BackofficeNavKey = "courses" | "portal" | "orders" | "payment" | "ai";

export type BackofficeNavItem = {
  href: string;
  key: BackofficeNavKey;
};

export function backofficeNavItems(locale: Locale, operator: boolean): BackofficeNavItem[] {
  const items: BackofficeNavItem[] = [{ href: `/${locale}/backoffice/courses`, key: "courses" }];
  if (!operator) return items;
  items.push(
    { href: `/${locale}/backoffice/portal`, key: "portal" },
    { href: `/${locale}/backoffice/orders`, key: "orders" },
    { href: `/${locale}/backoffice/payment`, key: "payment" },
    { href: "/knowledge/philosophy/epicureanism/chat-testing", key: "ai" }
  );
  return items;
}

export function isBackofficeNavActive(pathname: string, href: string, key: BackofficeNavKey) {
  if (key === "courses") return /\/backoffice\/courses(?:\/|$)/.test(pathname) || /\/backoffice\/?$/.test(pathname);
  if (key === "ai") return pathname.startsWith("/knowledge");
  return pathname === href || pathname.startsWith(`${href}/`);
}

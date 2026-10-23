import type { Locale } from "@/lib/i18n/config";
import { menuForBackofficePath, type BackofficeMenu } from "@/lib/backofficeRbac";

export type BackofficeNavKey = BackofficeMenu;

export type BackofficeNavItem = {
  href: string;
  key: BackofficeNavKey;
};

const MENU_PATHS: Record<BackofficeMenu, string> = {
  course: "courses",
  knowledge: "knowledge",
  aiTutor: "ai-tutor",
  order: "orders",
  reporting: "reporting",
  student: "students",
  helpdesk: "helpdesk",
  settings: "settings"
};

export function backofficeMenuHref(locale: Locale, menu: BackofficeMenu) {
  return `/${locale}/backoffice/${MENU_PATHS[menu]}`;
}

/** Sidebar items for the menus the server allowed, kept in PRD order. */
export function backofficeNavItems(locale: Locale, menus: readonly BackofficeMenu[]): BackofficeNavItem[] {
  return menus.map((key) => ({ key, href: backofficeMenuHref(locale, key) }));
}

export function isBackofficeNavActive(pathname: string, key: BackofficeNavKey) {
  if (/^\/(?:en-GB|zh-CN)\/backoffice\/?$/.test(pathname)) return key === "course";
  return menuForBackofficePath(pathname) === key;
}

export function backofficeLocaleHref(pathname: string, other: Locale) {
  if (/^\/(en-GB|zh-CN)(?:\/|$)/.test(pathname)) return pathname.replace(/^\/(en-GB|zh-CN)/, `/${other}`);
  // Knowledge / AI Tutor pages carry no locale in the URL; they read the saved
  // employee locale, so the switch stays on the same page.
  return pathname;
}

export type BackofficeSettingsKey = "employees" | "paymentGateway" | "notifications" | "portalContent";

export function backofficeSettingsItems(locale: Locale, manageEmployees: boolean): { key: BackofficeSettingsKey; href: string }[] {
  const base = `/${locale}/backoffice`;
  const items: { key: BackofficeSettingsKey; href: string }[] = [];
  if (manageEmployees) items.push({ key: "employees", href: `${base}/settings/employees` });
  items.push(
    { key: "paymentGateway", href: `${base}/payment` },
    { key: "notifications", href: `${base}/settings/notifications` },
    { key: "portalContent", href: `${base}/portal` }
  );
  return items;
}

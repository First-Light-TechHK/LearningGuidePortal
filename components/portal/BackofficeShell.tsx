"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CreditCard, FileText, Globe, Menu, Receipt, Sparkles } from "lucide-react";
import { backofficeLocaleHref, backofficeNavItems, isBackofficeNavActive, type BackofficeNavKey } from "@/lib/backofficeNav";
import { getCourseManagementMessages } from "@/lib/i18n/courseManagementMessages";
import { getMessages } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/config";
import { SignOutButton } from "./SignOutButton";
import styles from "./BackofficeShell.module.css";

const ICONS: Record<BackofficeNavKey, typeof BookOpen> = {
  courses: BookOpen,
  portal: FileText,
  orders: Receipt,
  payment: CreditCard,
  ai: Sparkles
};

export function BackofficeShell({
  locale,
  operator,
  user,
  children
}: {
  locale: Locale;
  operator: boolean;
  user: { nickname: string; email: string | null; role: string };
  children: ReactNode;
}) {
  const pathname = usePathname() || `/${locale}/backoffice/courses`;
  const [collapsed, setCollapsed] = useState(false);
  const copy = getCourseManagementMessages(locale);
  const messages = getMessages(locale);
  const labels: Record<BackofficeNavKey, string> = {
    courses: messages.backoffice.courses,
    portal: messages.portalEditor.heading,
    orders: messages.backoffice.orders.title,
    payment: messages.backoffice.payment.title,
    ai: copy.aiSettings
  };
  const items = useMemo(() => backofficeNavItems(locale, operator), [locale, operator]);
  const other = locale === "zh-CN" ? "en-GB" : "zh-CN";
  const localeHref = backofficeLocaleHref(pathname, other);
  const initials = (user.nickname || "LG").slice(0, 2).toUpperCase();

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.toggle} type="button" aria-label={copy.menu} onClick={() => setCollapsed((value) => !value)}>
            <Menu size={18} />
          </button>
          <Link className={styles.brand} href={`/${locale}/backoffice/courses`}>
            <span className={styles.logo}>LG</span>
            <span className={styles.brandName}>{messages.backoffice.shortTitle}</span>
          </Link>
        </div>
        <div className={styles.headerRight}>
          <Link className={styles.iconBtn} href={localeHref} hrefLang={other} aria-label={other}>
            <Globe size={16} />
            {locale === "zh-CN" ? "中" : "EN"}
          </Link>
          <div className={styles.user} title={user.email || undefined}>
            <span className={styles.avatar}>{initials}</span>
            <span className={styles.userDetail}>
              <span className={styles.userName}>{user.nickname}</span>
              <span className={styles.userRole}>{user.role}</span>
            </span>
          </div>
          <SignOutButton locale={locale} label={messages.learning.signOut} backoffice className={styles.iconBtn} />
        </div>
      </header>
      <div className={styles.body}>
        <aside className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ""}`}>
          <nav className={styles.nav} aria-label={messages.backoffice.title}>
            {items.map((item) => {
              const Icon = ICONS[item.key];
              const active = isBackofficeNavActive(pathname, item.href, item.key);
              return (
                <Link key={item.key} href={item.href} className={`${styles.item} ${active ? styles.itemActive : ""}`} aria-current={active ? "page" : undefined} title={labels[item.key]}>
                  <Icon size={20} aria-hidden="true" />
                  {!collapsed ? <span className={styles.label}>{labels[item.key]}</span> : null}
                </Link>
              );
            })}
          </nav>
        </aside>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Avatar, Button, Drawer } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CreditCard, FileText, Globe, Menu, Receipt, Sparkles } from "lucide-react";
import { backofficeLocaleHref, backofficeNavItems, isBackofficeNavActive, type BackofficeNavKey } from "@/lib/backofficeNav";
import { getCourseManagementMessages } from "@/lib/i18n/courseManagementMessages";
import { getMessages } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/config";
import { SignOutButton } from "./SignOutButton";
import styles from "./BackofficeShell.module.css";
import { useBackofficePopupContainer } from "@/components/backoffice/BackofficeProvider";

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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const getContainer = useBackofficePopupContainer();
  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 800px)");
    const sync = () => { setMobile(query.matches); if (!query.matches) setMobileOpen(false); };
    sync(); query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
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
  const navigation = (mobile = false) => <nav className={styles.nav} aria-label={messages.backoffice.title}>
    {items.map((item) => {
      const Icon = ICONS[item.key];
      const active = isBackofficeNavActive(pathname, item.href, item.key);
      return <Link key={item.key} href={item.href} onClick={() => { if (mobile) setMobileOpen(false); }} className={`${styles.item} ${active ? styles.itemActive : ""}`} aria-current={active ? "page" : undefined} title={labels[item.key]}>
        <Icon size={20} aria-hidden="true"/>{(mobile || !collapsed) && <span className={styles.label}>{labels[item.key]}</span>}
      </Link>;
    })}
  </nav>;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Button className={styles.toggle} type="text" icon={<Menu size={18}/>} aria-label={copy.menu} aria-expanded={mobile ? mobileOpen : !collapsed} onClick={() => { if (window.matchMedia("(max-width: 800px)").matches) setMobileOpen(true); else setCollapsed(value => !value); }}/>
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
            <Avatar className={styles.avatar}>{initials}</Avatar>
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
          {navigation()}
        </aside>
        <div className={styles.content}>{children}</div>
      </div>
      <Drawer title={messages.backoffice.title} placement="left" open={mobileOpen} onClose={() => setMobileOpen(false)} getContainer={getContainer} size="default" styles={{ wrapper: { maxWidth: "85vw" } }} destroyOnHidden>
        {navigation(true)}
      </Drawer>
    </div>
  );
}

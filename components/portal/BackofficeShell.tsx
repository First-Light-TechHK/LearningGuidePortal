"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, Key, LogOut } from "lucide-react";
import { backofficeLocaleHref, backofficeMenuHref, backofficeNavItems, isBackofficeNavActive } from "@/lib/backofficeNav";
import type { BackofficeMenu } from "@/lib/backofficeRbac";
import { getBackofficeShellMessages } from "@/lib/i18n/backofficeShellMessages";
import type { Locale } from "@/lib/i18n/config";
import { BackofficeChangePasswordDialog } from "./BackofficeChangePasswordDialog";
import styles from "./BackofficeShell.module.css";

// Figma 1017:2 "Backoffice Menu & Role": Remix icon names from the design.
const MENU_ICONS: Record<BackofficeMenu, string> = {
  course: "book-line",
  knowledge: "stack-line",
  aiTutor: "loader-fill",
  order: "booklet-line",
  reporting: "dashboard-2-line",
  student: "user-settings-line",
  helpdesk: "book-read-line",
  settings: "settings-2-line"
};

export function BackofficeIcon({ name, className }: { name: string; className?: string }) {
  return <span aria-hidden="true" className={`${styles.icon} ${className || ""}`} style={{ "--icon": `url(/backoffice/icons/${name}.svg)` } as CSSProperties} />;
}

export type BackofficeShellUser = { name: string; email: string | null; roleLabel: string };

export function BackofficeShell({
  locale,
  menus,
  user,
  children
}: {
  locale: Locale;
  menus: readonly BackofficeMenu[];
  user: BackofficeShellUser;
  children: ReactNode;
}) {
  const pathname = usePathname() || backofficeMenuHref(locale, "course");
  const router = useRouter();
  const copy = getBackofficeShellMessages(locale);
  const [collapsed, setCollapsed] = useState(false);
  const [openMenu, setOpenMenu] = useState<"language" | "profile" | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const headerRight = useRef<HTMLDivElement>(null);
  const items = backofficeNavItems(locale, menus);
  const initial = (user.name || "?").slice(0, 1).toUpperCase();

  useEffect(() => {
    try { setCollapsed(window.localStorage.getItem("lg.backoffice.sidebar") === "collapsed"); } catch { /* storage unavailable */ }
  }, []);

  useEffect(() => {
    if (!openMenu) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !headerRight.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [openMenu]);

  function toggleSidebar() {
    setCollapsed((value) => {
      try { window.localStorage.setItem("lg.backoffice.sidebar", value ? "expanded" : "collapsed"); } catch { /* storage unavailable */ }
      return !value;
    });
  }

  async function switchLanguage(next: Locale) {
    setOpenMenu(null);
    if (next === locale) return;
    try {
      await fetch("/api/backoffice/account/locale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale: next }) });
    } catch { /* the URL still switches the language for this visit */ }
    const target = backofficeLocaleHref(pathname, next) + (typeof window === "undefined" ? "" : window.location.search);
    if (target.split("?")[0] === pathname) router.refresh();
    else router.push(target);
  }

  async function signOut() {
    setOpenMenu(null); setSignOutError(false);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error();
      window.location.assign(`/${locale}/backoffice/sign-in`);
    } catch { setSignOutError(true); }
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} href={backofficeMenuHref(locale, "course")}>
          <span className={styles.logo}><BackofficeIcon name="graduation-cap-fill" className={styles.logoIcon} /></span>
          <span className={styles.brandName}>{copy.brand}</span>
        </Link>
        <div className={styles.headerRight} ref={headerRight}>
          <div className={styles.dropdownAnchor}>
            <button type="button" className={styles.languageButton} aria-haspopup="menu" aria-expanded={openMenu === "language"} aria-label={copy.language} onClick={() => setOpenMenu(openMenu === "language" ? null : "language")}>
              {copy.languageShort[locale]}<ChevronDown size={14} aria-hidden="true" />
            </button>
            {openMenu === "language" ? (
              <div className={styles.dropdown} role="menu">
                {(["en-GB", "zh-CN"] as const).map((option) => (
                  <button key={option} type="button" role="menuitemradio" aria-checked={option === locale} className={styles.dropdownItem} onClick={() => switchLanguage(option)}>
                    {copy.languages[option]}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className={styles.dropdownAnchor}>
            <button type="button" className={styles.user} aria-haspopup="menu" aria-expanded={openMenu === "profile"} aria-label={copy.accountMenu} title={user.email || undefined} onClick={() => setOpenMenu(openMenu === "profile" ? null : "profile")}>
              <span className={styles.avatar}>{initial}</span>
              <span className={styles.userDetail}>
                <span className={styles.userName}>{user.name}</span>
                <span className={styles.userRole}>{user.roleLabel}</span>
              </span>
            </button>
            {openMenu === "profile" ? (
              <div className={styles.profileMenu} role="menu">
                <div className={styles.divider} />
                <button type="button" role="menuitem" className={styles.profileItem} onClick={() => { setOpenMenu(null); setPasswordOpen(true); }}>
                  <Key size={18} aria-hidden="true" />{copy.changePassword}
                </button>
                <div className={styles.divider} />
                <button type="button" role="menuitem" className={styles.profileItem} onClick={signOut}>
                  <LogOut size={18} aria-hidden="true" />{copy.signOut}
                </button>
              </div>
            ) : null}
            {signOutError ? <span role="alert" className={styles.inlineError}>{copy.password.errors.failed}</span> : null}
          </div>
        </div>
      </header>
      <div className={styles.body}>
        <aside className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ""}`}>
          <button className={styles.collapse} type="button" aria-label={collapsed ? copy.expand : copy.collapse} aria-expanded={!collapsed} title={collapsed ? copy.expand : copy.collapse} onClick={toggleSidebar}>
            <svg width="20" height="18" viewBox="0 0 20 18" fill="none" aria-hidden="true">
              <rect x="1" y="1" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
              <path d="M6 5v8M14 9H9m0 0 2.5-2.5M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={collapsed ? { transform: "rotate(180deg)", transformOrigin: "10px 9px" } : undefined} />
            </svg>
          </button>
          <nav className={styles.nav} aria-label={copy.brand}>
            {items.map((item) => {
              const active = isBackofficeNavActive(pathname, item.key);
              const label = copy.menus[item.key];
              return (
                <Link key={item.key} href={item.href} data-menu={item.key} className={`${styles.item} ${active ? styles.itemActive : ""}`} aria-current={active ? "page" : undefined} title={collapsed ? label : undefined} aria-label={collapsed ? label : undefined}>
                  <BackofficeIcon name={MENU_ICONS[item.key]} />
                  {!collapsed ? <span className={styles.label}>{label}</span> : null}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className={styles.content}>{children}</main>
      </div>
      {passwordOpen ? <BackofficeChangePasswordDialog locale={locale} onClose={() => setPasswordOpen(false)} /> : null}
    </div>
  );
}

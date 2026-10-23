import type { ReactNode } from "react";
import Link from "next/link";
import { backofficeSettingsItems, type BackofficeSettingsKey } from "@/lib/backofficeNav";
import { getBackofficeShellMessages } from "@/lib/i18n/backofficeShellMessages";
import type { Locale } from "@/lib/i18n/config";
import styles from "./BackofficeShell.module.css";

// Figma 778:620 "Menu List": Settings second-level menu beside the page card.
// Employee Account is listed for Admin only (PRD §3.3).
export function BackofficeSettingsFrame({ locale, active, manageEmployees, children }: { locale: Locale; active: BackofficeSettingsKey; manageEmployees: boolean; children: ReactNode }) {
  const copy = getBackofficeShellMessages(locale).settings;
  return (
    <div className={styles.settings}>
      <nav className={styles.subnav} aria-label={getBackofficeShellMessages(locale).menus.settings}>
        {backofficeSettingsItems(locale, manageEmployees).map((item) => (
          <Link key={item.key} href={item.href} data-settings={item.key} className={`${styles.subnavItem} ${item.key === active ? styles.subnavActive : ""}`} aria-current={item.key === active ? "page" : undefined}>
            {copy[item.key]}
          </Link>
        ))}
      </nav>
      <div className={styles.settingsMain}>{children}</div>
    </div>
  );
}

export function BackofficePlaceholder({ title, subtitle, note }: { title: string; subtitle: string; note: string }) {
  return (
    <section className={styles.page} data-placeholder="true">
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{title}</h1>
          <p className={styles.pageSubtitle}>{subtitle}</p>
        </div>
      </div>
      <p className={styles.empty}>{note}</p>
    </section>
  );
}

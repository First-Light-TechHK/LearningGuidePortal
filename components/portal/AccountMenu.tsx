"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, ChevronDown, LogOut, Settings, UserRound } from "lucide-react";
import Link from "next/link";

type AccountMenuProps = {
  locale: "en-GB" | "zh-CN";
  displayName?: string;
  avatarUrl?: string;
  labels: {
    myLearning: string;
    settings: string;
    notifications: string;
    signOut: string;
  };
};

export function AccountMenu({ locale, displayName, avatarUrl, labels }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const initial = (displayName?.trim()[0] || "L").toUpperCase();

  useEffect(() => {
    function closeOnOutside(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  async function signOut() {
    setOpen(false);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign(`/${locale}/portal`);
    }
  }

  return (
    <div className="account-menu" ref={menuRef}>
      <button
        className="account-menu-trigger"
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={displayName ? `${displayName} account menu` : "Account menu"}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="portal-header-avatar">
          {avatarUrl ? <img src={avatarUrl} alt="" /> : initial}
        </span>
        <ChevronDown className={open ? "account-menu-chevron open" : "account-menu-chevron"} size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div className="account-menu-popover" role="menu">
          <div className="account-menu-identity">
            <span className="account-menu-identity-avatar">{avatarUrl ? <img src={avatarUrl} alt="" /> : initial}</span>
            <div>
              <strong>{displayName || "Learner"}</strong>
              <span>{labels.myLearning}</span>
            </div>
          </div>
          <div className="account-menu-links">
            <Link href={`/${locale}/account/my-learning`} role="menuitem" onClick={() => setOpen(false)}><UserRound size={16} aria-hidden="true" />{labels.myLearning}</Link>
            <Link href={`/${locale}/account/my-learning/settings`} role="menuitem" onClick={() => setOpen(false)}><Settings size={16} aria-hidden="true" />{labels.settings}</Link>
            <Link href={`/${locale}/account/my-learning/notifications`} role="menuitem" onClick={() => setOpen(false)}><Bell size={16} aria-hidden="true" />{labels.notifications}</Link>
            <button type="button" role="menuitem" onClick={() => void signOut()}><LogOut size={16} aria-hidden="true" />{labels.signOut}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

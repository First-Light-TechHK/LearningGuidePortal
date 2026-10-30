"use client";

import React, { useRef, useState } from "react";
import { Bell, ChevronDown, LogOut, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { Dropdown } from "antd";
import { PortalProvider } from "./ui/PortalProvider";
import { getMessages } from "@/lib/i18n/messages";

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

export function AccountMenu(props: AccountMenuProps) {
  return <PortalProvider locale={props.locale}><AccountMenuContent {...props}/></PortalProvider>;
}

function AccountMenuContent({ locale, displayName, avatarUrl, labels }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const signingOut = useRef(false);
  const name = displayName?.trim() || "Name";
  const initial = name[0].toUpperCase();

  async function signOut() {
    if (signingOut.current) return;
    signingOut.current = true; setBusy(true); setOpen(false);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign(`/${locale}/portal`);
    }
  }

  return <div className="account-menu">
    <Dropdown
      trigger={["click"]} open={open} placement="bottomRight" autoFocus destroyOnHidden
      classNames={{ root: "portal-account-dropdown" }}
      onOpenChange={value => { if (!busy) setOpen(value); }}
      popupRender={menu => <div className="portal-account-popup" onKeyDown={event => {
        if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
      }}><div className="account-menu-identity">
        <span className="account-menu-identity-avatar">{avatarUrl ? <img src={avatarUrl} alt=""/> : initial}</span>
        <strong>{name}</strong>
      </div>{menu}</div>}
      menu={{ items: [
        { key: "learning", icon: <UserRound size={16} aria-hidden="true"/>, label: <Link href={`/${locale}/account/my-learning`}>{labels.myLearning}</Link> },
        { key: "settings", icon: <Settings size={16} aria-hidden="true"/>, label: <Link href={`/${locale}/account/my-learning/settings`}>{labels.settings}</Link> },
        { key: "notifications", icon: <Bell size={16} aria-hidden="true"/>, label: <Link href={`/${locale}/account/my-learning/notifications`}>{labels.notifications}</Link> },
        { key: "logout", icon: <LogOut size={16} aria-hidden="true"/>, label: labels.signOut, disabled: busy },
      ], onClick: ({ key }) => { setOpen(false); if (key === "logout") void signOut(); } }}
    >
      <button ref={trigger} className="account-menu-trigger" type="button" disabled={busy}
        aria-expanded={open} aria-haspopup="menu"
        aria-label={getMessages(locale).portal.accountMenu.replace("{name}", name)}>
        <span className="portal-header-avatar">{avatarUrl ? <img src={avatarUrl} alt=""/> : initial}</span>
        <ChevronDown className={open ? "account-menu-chevron open" : "account-menu-chevron"} size={15} aria-hidden="true"/>
      </button>
    </Dropdown>
  </div>;
}

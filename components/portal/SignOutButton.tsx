"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { getCourseManagementMessages } from "@/lib/i18n/courseManagementMessages";

export function SignOutButton({ label, locale, backoffice = false, className }: { label: string; locale: "en-GB" | "zh-CN"; backoffice?: boolean; className?: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  async function signOut() {
    setBusy(true); setError(false);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error();
      window.location.assign(backoffice ? `/${locale}/backoffice/sign-in` : `/${locale}/portal`);
    } catch { setError(true); setBusy(false); }
  }
  return <><button className={className || "portal-text-button"} onClick={signOut} type="button" disabled={busy} aria-label={label} title={label}>{backoffice && <LogOut size={18} aria-hidden="true"/>}{label}</button>{error && <span role="alert">{getCourseManagementMessages(locale).errors.failed}</span>}</>;
}

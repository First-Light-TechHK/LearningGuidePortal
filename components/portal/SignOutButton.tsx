"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { getCourseManagementMessages } from "@/lib/i18n/courseManagementMessages";

export function SignOutButton({ label, locale, backoffice = false }: { label: string; locale: "en-GB" | "zh-CN"; backoffice?: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  async function signOut() {
    setBusy(true); setError(false);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error();
      window.location.assign(backoffice ? `/${locale}/backoffice/sign-in` : `/${locale}/portal`);
    } catch { setError(true); setBusy(false); }
  }
  return <><button className="portal-text-button" onClick={signOut} type="button" disabled={busy} style={backoffice ? { display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" } : undefined}>{backoffice && <LogOut size={18} aria-hidden="true"/>}{label}</button>{error && <span role="alert">{getCourseManagementMessages(locale).errors.failed}</span>}</>;
}

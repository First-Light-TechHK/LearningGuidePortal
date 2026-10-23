"use client";

import { useState, type FormEvent } from "react";
import { getBackofficeShellMessages } from "@/lib/i18n/backofficeShellMessages";
import type { Locale } from "@/lib/i18n/config";
import styles from "./BackofficeShell.module.css";

type ErrorKey = "mismatch" | "NEW_PASSWORD_TOO_SHORT" | "CURRENT_PASSWORD_INCORRECT" | "failed";

// PORT-P08 Change Password. The server revokes every session on success,
// so the employee signs in again with the new password.
export function BackofficeChangePasswordDialog({ locale, onClose }: { locale: Locale; onClose: () => void }) {
  const copy = getBackofficeShellMessages(locale).password;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword") || "");
    const newPassword = String(form.get("newPassword") || "");
    if (newPassword !== String(form.get("confirmPassword") || "")) { setError("mismatch"); return; }
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/backoffice/account/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
      const body = await response.json().catch(() => ({})) as { ok?: boolean; code?: string };
      if (!response.ok || !body.ok) {
        setError(body.code === "NEW_PASSWORD_TOO_SHORT" || body.code === "CURRENT_PASSWORD_INCORRECT" ? body.code : "failed");
        setBusy(false);
        return;
      }
      setDone(true);
      window.setTimeout(() => window.location.assign(`/${locale}/backoffice/sign-in`), 1500);
    } catch { setError("failed"); setBusy(false); }
  }

  return (
    <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="bo-change-password-title">
        <div className={styles.pageHeader}><h2 id="bo-change-password-title" className={styles.pageTitle}>{copy.title}</h2></div>
        <form onSubmit={submit}>
          <label className={styles.field}>{copy.current}<input name="currentPassword" type="password" autoComplete="current-password" required disabled={busy || done} /></label>
          <label className={styles.field}>{copy.next}<input name="newPassword" type="password" autoComplete="new-password" minLength={8} required disabled={busy || done} /></label>
          <label className={styles.field}>{copy.confirm}<input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required disabled={busy || done} /></label>
          {error ? <p role="alert" className={styles.formError}>{copy.errors[error]}</p> : null}
          {done ? <p role="status" className={styles.pageSubtitle}>{copy.saved}</p> : null}
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={onClose} disabled={busy || done}>{copy.cancel}</button>
            <button type="submit" className={styles.primary} disabled={busy || done}>{copy.save}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

"use client";

import { FormEvent, useEffect, useState } from "react";

type Copy = { checkEmailTitle: string; checkEmailDescription: string; resendEmail: string; resendSent: string; email: string; resendCountdown: string };

export function CheckEmail({ locale, copy, initialEmail = "", resendOnArrival = false }: { locale: "en-GB" | "zh-CN"; copy: Copy; initialEmail?: string; resendOnArrival?: boolean }) {
  const [email, setEmail] = useState(initialEmail);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(60);
  useEffect(() => { if (seconds <= 0) return; const timer = window.setInterval(() => setSeconds(value => Math.max(0, value - 1)), 1000); return () => window.clearInterval(timer); }, [seconds]);
  useEffect(() => {
    if (!resendOnArrival || !email.trim()) return;
    void fetch("/api/auth/resend-verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, locale }) }).catch(() => {});
  }, [email, locale, resendOnArrival]);
  useEffect(() => {
    const normalisedEmail = email.trim().toLowerCase();
    if (!normalisedEmail) return;
    let cancelled = false;
    async function checkActivation() {
      try {
        const response = await fetch("/api/auth/check-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: normalisedEmail }) });
        const result = await response.json() as { ok?: boolean; data?: { exists?: boolean; pending?: boolean } };
        if (!cancelled && response.ok && result.ok && result.data?.exists && !result.data.pending) {
          window.location.assign(`/${locale}/portal/verify-email?email=${encodeURIComponent(normalisedEmail)}`);
        }
      } catch {
        // A transient polling failure must not interrupt email verification or resend.
      }
    }
    void checkActivation();
    const timer = window.setInterval(() => void checkActivation(), 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [email, locale]);
  async function resend(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/auth/resend-verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, locale }) });
      const result = await response.json() as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message || "Request failed.");
      setMessage(copy.resendSent);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Request failed."); }
    finally { setBusy(false); setSeconds(60); }
  }
  const disabled = busy || seconds > 0 || !email.trim();
  return <section className="portal-form"><h1>{copy.checkEmailTitle}</h1><p>{copy.checkEmailDescription}</p><form onSubmit={resend}><label>{copy.email}<input type="email" value={email} readOnly required autoComplete="email" /></label>{error ? <p className="portal-form-error" role="alert">{error}</p> : null}{message ? <p className="portal-success" role="status">{message}</p> : null}<button className="portal-button portal-button-secondary" disabled={disabled}>{seconds > 0 ? `${copy.resendCountdown} (${seconds}s)` : copy.resendEmail}</button></form></section>;
}

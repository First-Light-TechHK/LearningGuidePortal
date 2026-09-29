"use client";

import { FormEvent, useEffect, useState } from "react";

type Copy = { checkEmailTitle: string; checkEmailDescription: string; resendEmail: string; resendSent: string; email: string; resendCountdown: string; verificationDailyLimit: string; requestFailed: string; emailDeliveryNotConfigured: string };

export function CheckEmail({ locale, copy, initialEmail = "" }: { locale: "en-GB" | "zh-CN"; copy: Copy; initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => { if (seconds <= 0) return; const timer = window.setInterval(() => setSeconds(value => Math.max(0, value - 1)), 1000); return () => window.clearInterval(timer); }, [seconds]);
  async function resend(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/auth/resend-verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, locale }) });
      const result = await response.json() as { ok?: boolean; code?: string; data?: { retryAfter?: number } };
      if (result.code === "VERIFICATION_RATE_LIMITED") { setSeconds(result.data?.retryAfter || 1); return; }
      if (result.code === "VERIFICATION_DAILY_LIMIT") throw new Error(copy.verificationDailyLimit);
      if (!response.ok || !result.ok) throw new Error(result.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? copy.emailDeliveryNotConfigured : copy.requestFailed);
      setMessage(copy.resendSent);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : copy.requestFailed); }
    finally { setBusy(false); setSeconds(60); }
  }
  const disabled = busy || seconds > 0 || !email.trim();
  return <section className="portal-form"><h1>{copy.checkEmailTitle}</h1><p>{copy.checkEmailDescription}</p><form onSubmit={resend}><label>{copy.email}<input type="email" value={email} readOnly required autoComplete="email" /></label>{error ? <p className="portal-form-error" role="alert">{error}</p> : null}{message ? <p className="portal-success" role="status">{message}</p> : null}<button className="portal-button portal-button-secondary" disabled={disabled}>{seconds > 0 ? `${copy.resendCountdown} (${seconds}s)` : copy.resendEmail}</button></form></section>;
}

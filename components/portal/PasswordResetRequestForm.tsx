"use client";
import { FormEvent, useEffect, useState } from "react";
import { getMessages } from "@/lib/i18n/messages";

export function PasswordResetRequestForm({ locale, returnTo, initialEmail = "", sent = false }: { locale: "en-GB" | "zh-CN"; returnTo: string; initialEmail?: string; sent?: boolean }) {
  const copy = getMessages(locale).auth;
  const [email, setEmail] = useState(initialEmail);
  const [resetUrl, setResetUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(sent ? 60 : 0);
  const [completed, setCompleted] = useState(sent);
  useEffect(() => {
    if (!seconds) return;
    const timer = setTimeout(() => setSeconds(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/password-reset/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, locale, returnTo }) });
      const data = await response.json() as { ok?: boolean; resetUrl?: string | null };
      if (!response.ok || !data.ok) throw new Error();
      setSeconds(60); setCompleted(true); setResetUrl(data.resetUrl || "");
      if (!sent && !data.resetUrl) window.location.assign(`/${locale}/portal/password-reset-sent?${new URLSearchParams({ email: email.trim(), returnTo })}`);
    } catch { setError(copy.resetRequestError); }
    finally { setBusy(false); }
  }
  const signInPath = `/${locale}/portal/sign-in?${new URLSearchParams({ email, returnTo, step: "password" })}`;
  return <form className="portal-form" onSubmit={submit}><h1>{completed ? copy.resetCheckTitle : copy.forgotPassword}</h1>
    {completed ? <><p role="status">{copy.resetCheckDescription}</p><p>{email}</p></> : <label>{copy.email}<input type="email" value={email} onChange={event => setEmail(event.target.value)} required autoComplete="email" /></label>}
    {error ? <p className="portal-form-error" role="alert">{error}</p> : null}
    {resetUrl ? <a href={resetUrl}>{copy.resetPreview}</a> : null}
    <button className="portal-button portal-button-primary" disabled={busy || seconds > 0}>{busy ? "..." : completed ? copy.resetResend : copy.resetSend}</button>
    {seconds > 0 ? <p role="status">{copy.resetWait.replace("{seconds}", String(seconds))}</p> : null}
    {completed ? <a href={`/${locale}/portal/forgot-password?${new URLSearchParams({ returnTo })}`}>{copy.resetChangeEmail}</a> : null}
    <a href={signInPath}>{copy.submitSignIn}</a>
  </form>;
}

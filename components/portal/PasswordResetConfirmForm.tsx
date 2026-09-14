"use client";

import { getMessages } from "@/lib/i18n/messages";
import { FormEvent, useState } from "react";

export function PasswordResetConfirmForm({ token, locale, signInPath, requestPath }: { token: string; locale: "en-GB" | "zh-CN"; signInPath: string; requestPath: string }) {
  const copy = getMessages(locale).auth;
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setMessage("");
    if (password !== confirmation) { setError(copy.resetMismatch); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/password-reset/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, newPassword: password }) });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(copy.resetConfirmError);
      window.history.replaceState({}, "", window.location.pathname + "?returnTo=" + encodeURIComponent(new URL(signInPath, window.location.origin).searchParams.get("returnTo") || ""));
      setMessage(copy.resetDone); setPassword(""); setConfirmation("");
    } catch (requestError) { setError(copy.resetConfirmError); }
    finally { setBusy(false); }
  }
  if (message) return <section className="portal-form"><h1>{copy.success}</h1><p role="status">{message}</p><a className="portal-button portal-button-primary" href={signInPath}>{copy.submitSignIn}</a></section>;
  return <form className="portal-form" onSubmit={submit}><h1>{copy.submit}</h1><label>{copy.password}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required autoComplete="new-password" /></label><label>{copy.confirmPassword}<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={8} required autoComplete="new-password" /></label>{error ? <p className="portal-form-error" role="alert">{error}</p> : null}{message ? <p className="portal-success" role="status">{message}</p> : null}<button className="portal-button portal-button-primary" disabled={busy}>{busy ? "..." : copy.submit}</button><a href={requestPath}>{copy.resetAgain}</a><a href={signInPath}>{copy.submitSignIn}</a></form>;
}

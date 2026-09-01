"use client";

import { FormEvent, useState } from "react";

export function PasswordResetRequestForm({ copy }: { copy: { email: string; submit: string; sent: string } }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [resetUrl, setResetUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/auth/password-reset/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, locale: window.location.pathname.startsWith("/zh-CN/") ? "zh-CN" : "en-GB" }) });
      const data = await response.json() as { ok?: boolean; error?: string; resetUrl?: string | null };
      if (!response.ok || !data.ok) throw new Error(data.error || "Password reset request failed.");
      setMessage(copy.sent); setResetUrl(data.resetUrl || "");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Password reset request failed."); }
    finally { setBusy(false); }
  }
  return <form className="portal-form" onSubmit={submit}><h1>{copy.submit}</h1><label>{copy.email}<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label>{error ? <p className="portal-form-error" role="alert">{error}</p> : null}{message ? <p className="portal-success" role="status">{message}</p> : null}{resetUrl ? <a href={resetUrl}>Continue to set a new password</a> : null}<button className="portal-button portal-button-primary" disabled={busy}>{busy ? "..." : copy.submit}</button></form>;
}

"use client";

import { FormEvent, useState } from "react";

export function PasswordResetConfirmForm({ token, copy, signInPath }: { token: string; copy: { password: string; confirmPassword: string; submit: string; success: string }; signInPath: string }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setMessage("");
    if (password !== confirmation) { setError("The passwords do not match."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/password-reset/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, newPassword: password }) });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Password reset failed.");
      setMessage(copy.success); setPassword(""); setConfirmation("");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Password reset failed."); }
    finally { setBusy(false); }
  }
  return <form className="portal-form" onSubmit={submit}><h1>{copy.submit}</h1><label>{copy.password}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required autoComplete="new-password" /></label><label>{copy.confirmPassword}<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={8} required autoComplete="new-password" /></label>{error ? <p className="portal-form-error" role="alert">{error}</p> : null}{message ? <p className="portal-success" role="status">{message}</p> : null}<button className="portal-button portal-button-primary" disabled={busy}>{busy ? "..." : copy.submit}</button><a href={signInPath}>{copy.success}</a></form>;
}

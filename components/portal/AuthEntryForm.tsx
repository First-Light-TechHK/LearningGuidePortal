"use client";

import { FormEvent, useState } from "react";

type Copy = { email: string; emailContinue: string; emailEntryDescription: string; or: string; google: string; wechat: string; backToPortal: string };

export function AuthEntryForm({ locale, copy, returnTo, googleEnabled, wechatEnabled }: { locale: "en-GB" | "zh-CN"; copy: Copy; returnTo: string; googleEnabled?: boolean; wechatEnabled?: boolean }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/check-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const data = await response.json() as { exists?: boolean; error?: string };
      if (!response.ok) throw new Error(data.error || "Email check failed.");
      const query = `email=${encodeURIComponent(email.trim())}&returnTo=${encodeURIComponent(returnTo)}`;
      const path = data.exists ? `sign-in?step=password&${query}` : `sign-up?${query}`;
      window.location.assign(`/${locale}/portal/${path}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Email check failed.");
      setBusy(false);
    }
  }

  return <form className="portal-form auth-entry-form" onSubmit={submit}><p className="auth-entry-description">{copy.emailEntryDescription}</p><label>{copy.email}<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label>{error ? <p className="portal-form-error" role="alert">{error}</p> : null}<button className="portal-button portal-button-primary" disabled={busy}>{busy ? "..." : copy.emailContinue}</button>{googleEnabled || wechatEnabled ? <div className="auth-provider-options"><span>{copy.or}</span>{googleEnabled ? <a className="portal-button portal-button-secondary" href={`/api/auth/google?locale=${locale}&returnTo=${encodeURIComponent(returnTo)}`}>{copy.google}</a> : null}{wechatEnabled ? <a className="portal-button portal-button-secondary" href={`/api/auth/wechat?locale=${locale}&returnTo=${encodeURIComponent(returnTo)}`}>{copy.wechat}</a> : null}</div> : null}<a href={`/${locale}/portal`}>{copy.backToPortal}</a></form>;
}

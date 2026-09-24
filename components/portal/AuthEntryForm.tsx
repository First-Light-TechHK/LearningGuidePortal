"use client";

import { FormEvent, useState } from "react";
import { AuthProviders } from "@/components/portal/AuthProviders";
import { Mail } from "lucide-react";
import { isBusinessEmail, isEmailTooLong, normaliseEmail } from "@/lib/emailValidation";

type Copy = { email: string; emailInvalid: string; emailTooLong: string; emailContinue: string; emailEntryDescription: string; emailCheckFailed: string; or: string; google: string; wechat: string; backToPortal: string };

export function AuthEntryForm({ locale, copy, returnTo, googleEnabled, wechatEnabled }: { locale: "en-GB" | "zh-CN"; copy: Copy; returnTo: string; googleEnabled?: boolean; wechatEnabled?: boolean }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const normalizedEmail = normaliseEmail(email);
    if (isEmailTooLong(normalizedEmail)) { setError(copy.emailTooLong); return; }
    if (!isBusinessEmail(normalizedEmail)) { setError(copy.emailInvalid); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/check-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: normalizedEmail }) });
      const data = await response.json() as { ok?: boolean; code?: string; data?: { exists?: boolean; pending?: boolean } };
      if (!response.ok || !data.ok) throw new Error(data.code === "EMAIL_TOO_LONG" ? copy.emailTooLong : data.code === "EMAIL_INVALID" ? copy.emailInvalid : copy.emailCheckFailed);
      const destination = data.data?.pending ? "check-email" : data.data?.exists ? "sign-in?step=password" : "sign-up";
      const query = new URLSearchParams({ email: normalizedEmail, returnTo }).toString();
      window.location.assign(`/${locale}/portal/${destination}${destination.includes("?") ? "&" : "?"}${query}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.emailCheckFailed);
      setBusy(false);
    }
  }

  return <form className="portal-form auth-entry-form" onSubmit={submit}><p className="auth-entry-description">{copy.emailEntryDescription}</p><label>{copy.email}<span className="auth-input"><Mail size={20} aria-hidden="true" /><input type="email" value={email} onChange={(event) => { event.currentTarget.setCustomValidity(""); const value = event.target.value; setEmail(value); if (isEmailTooLong(value)) setError(copy.emailTooLong); else if (error === copy.emailTooLong) setError(""); }} onInvalid={(event) => event.currentTarget.setCustomValidity(isEmailTooLong(event.currentTarget.value) ? copy.emailTooLong : copy.emailInvalid)} required autoComplete="email" placeholder="you@example.com" /></span></label>{error ? <p className="portal-form-error" role="alert">{error}</p> : null}<button className="portal-button portal-button-primary" disabled={busy}>{copy.emailContinue}</button><AuthProviders locale={locale} returnTo={returnTo} copy={copy} googleEnabled={googleEnabled} wechatEnabled={wechatEnabled} /><a href={`/${locale}/portal`}>{copy.backToPortal}</a></form>;
}

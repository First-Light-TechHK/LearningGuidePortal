"use client";

import { FormEvent, useState } from "react";
import { Eye, EyeOff, Lock, Mail, User } from "lucide-react";
import { getMessages } from "@/lib/i18n/messages";

export function AdminSignInForm({ locale }: { locale: "en-GB" | "zh-CN" }) {
  const copy = getMessages(locale);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("Operator");
  const [showPassword, setShowPassword] = useState(false);
  const [register, setRegister] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(register ? "/api/auth/admin/register" : "/api/auth/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, nickname, locale, rememberMe: true })
      });
      const data = await response.json() as { ok?: boolean; code?: string; data?: { verificationRequired?: boolean } };
      if (!response.ok || !data.ok) {
        const message = data.code === "OPERATOR_REQUIRED" ? copy.backoffice.operatorRequired
          : data.code === "AUTHOR_REQUIRED" ? copy.backoffice.authorRequired
          : data.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? copy.auth.emailDeliveryNotConfigured
          : data.code === "EMAIL_NOT_VERIFIED" ? copy.backoffice.verifyEmail
          : copy.backoffice.signInFailed;
        throw new Error(message);
      }
      if (data.data?.verificationRequired) {
        setNotice(copy.backoffice.verifyEmail);
        setBusy(false);
        return;
      }
      window.location.assign(`/${locale}/backoffice/courses`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.backoffice.signInFailed);
      setBusy(false);
    }
  }

  return (
    <form className="portal-form auth-credential-form auth-sign-in" onSubmit={submit}>
      <label>{copy.auth.email}<span className="auth-input"><Mail size={20} aria-hidden="true" /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></span></label>
      {register ? <label>{copy.auth.nickname}<span className="auth-input"><User size={20} aria-hidden="true" /><input value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={40} autoComplete="nickname" /></span></label> : null}
      <label>{copy.auth.password}<span className="auth-input"><Lock size={20} aria-hidden="true" /><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete={register ? "new-password" : "current-password"} /><button className="auth-password-toggle" type="button" aria-label={showPassword ? copy.auth.hidePassword : copy.auth.showPassword} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button></span></label>
      {error ? <p className="portal-form-error" role="alert">{error}</p> : null}
      {notice ? <p className="portal-lead" role="status">{notice}</p> : null}
      <button className="portal-button portal-button-primary auth-submit" disabled={busy}>{register ? copy.backoffice.createOperator : copy.auth.submitSignIn}</button>
      <button className="portal-button portal-button-secondary" type="button" onClick={() => { setRegister((value) => !value); setError(""); setNotice(""); }}>{register ? copy.backoffice.haveOperator : copy.backoffice.firstOperator}</button>
    </form>
  );
}

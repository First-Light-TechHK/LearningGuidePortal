"use client";

import { FormEvent, useState } from "react";
import { Eye, EyeOff, Lock, Mail, User } from "lucide-react";
import { getMessages } from "@/lib/i18n/messages";
import { AuthProviders } from "@/components/portal/AuthProviders";

export function AuthForm({ locale, mode, copy, returnTo, googleEnabled, wechatEnabled, providerError, showTitle = true, initialEmail = "" }: { locale: "en-GB" | "zh-CN"; mode: "sign-in" | "sign-up"; copy: { signInTitle: string; signUpTitle: string; email: string; password: string; nickname: string; submitSignIn: string; submitSignUp: string; noAccount: string; haveAccount: string; backToPortal: string; forgotPassword: string; or: string; google: string; wechat: string }; returnTo: string; googleEnabled?: boolean; wechatEnabled?: boolean; providerError?: string; showTitle?: boolean; initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState(providerError || "");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const labels = getMessages(locale).auth;
  const signIn = mode === "sign-in";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/auth/${mode === "sign-in" ? "login" : "register"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, nickname, locale, rememberMe }) });
      const data = await response.json() as { ok?: boolean; message?: string; data?: { verificationRequired?: boolean } };
      if (!response.ok || !data.ok) throw new Error(data.message || "Request failed.");
      if (data.data?.verificationRequired) return window.location.assign(`/${locale}/portal/check-email`);
      window.location.assign(returnTo || `/${locale}/account/my-learning`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Request failed.");
      setBusy(false);
    }
  }

  const switchPath = `${signIn ? `/${locale}/portal/sign-up` : `/${locale}/portal/sign-in`}?returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <form className={`portal-form auth-credential-form ${signIn ? "auth-sign-in" : "auth-sign-up"}`} onSubmit={submit}>
      {showTitle ? <h1>{signIn ? copy.signInTitle : copy.signUpTitle}</h1> : null}
      <div className="auth-fields">
        {!signIn ? <label>{copy.nickname}<span className="auth-input"><User size={20} aria-hidden="true" /><input value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={40} autoComplete="nickname" /></span></label> : null}
        <label>{copy.email}<span className="auth-input"><Mail size={20} aria-hidden="true" /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder="you@example.com" /></span></label>
        <label>{copy.password}<span className="auth-input"><Lock size={20} aria-hidden="true" /><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete={signIn ? "current-password" : "new-password"} /><button className="auth-password-toggle" type="button" aria-label={showPassword ? labels.hidePassword : labels.showPassword} title={showPassword ? labels.hidePassword : labels.showPassword} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button></span></label>
      </div>
      {signIn ? <div className="auth-options"><label><input type="checkbox" checked={rememberMe} onChange={event => setRememberMe(event.target.checked)} />{labels.rememberMe}</label><a href={`/${locale}/portal/forgot-password`}>{copy.forgotPassword}</a></div> : null}
      {error ? <p className="portal-form-error" role="alert">{error}</p> : null}
      <button className="portal-button portal-button-primary auth-submit" disabled={busy}>{busy ? "..." : signIn ? copy.submitSignIn : copy.submitSignUp}</button>
      {showTitle ? <a href={switchPath}>{signIn ? copy.noAccount : copy.haveAccount}</a> : null}
      <AuthProviders locale={locale} returnTo={returnTo} copy={copy} googleEnabled={googleEnabled} wechatEnabled={wechatEnabled} />
      {showTitle ? <a href={`/${locale}/portal`}>{copy.backToPortal}</a> : null}
    </form>
  );
}

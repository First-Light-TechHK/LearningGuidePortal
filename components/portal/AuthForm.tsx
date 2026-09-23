"use client";

import { FormEvent, useEffect, useState } from "react";
import { Eye, EyeOff, Lock, Mail, User } from "lucide-react";
import { getMessages } from "@/lib/i18n/messages";
import { AuthProviders } from "@/components/portal/AuthProviders";
import { isBusinessEmail } from "@/lib/emailValidation";
import { isValidName } from "@/lib/nameValidation";

const REMEMBERED_CREDENTIALS_KEY = "learning-guide.remembered-credentials";

function rememberCredentials(credentials: { email: string; password: string } | null) {
  try {
    if (credentials) window.localStorage.setItem(REMEMBERED_CREDENTIALS_KEY, JSON.stringify({ email: credentials.email.trim(), password: credentials.password }));
    else window.localStorage.removeItem(REMEMBERED_CREDENTIALS_KEY);
  } catch {
    // Storage may be disabled; signing in must still work.
  }
}

export function AuthForm({ locale, mode, copy, returnTo, googleEnabled, wechatEnabled, providerError, showTitle = true, initialEmail = "" }: { locale: "en-GB" | "zh-CN"; mode: "sign-in" | "sign-up"; copy: { signInTitle: string; signUpTitle: string; email: string; password: string; nickname: string; submitSignIn: string; submitSignUp: string; noAccount: string; haveAccount: string; backToPortal: string; forgotPassword: string; or: string; google: string; wechat: string; existingEmailNotice: string; existingEmailCountdown: string }; returnTo: string; googleEnabled?: boolean; wechatEnabled?: boolean; providerError?: string; showTitle?: boolean; initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState(providerError || "");
  const [existingNotice, setExistingNotice] = useState("");
  const [existingSeconds, setExistingSeconds] = useState(3);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const labels = getMessages(locale).auth;
  const signIn = mode === "sign-in";

  useEffect(() => {
    if (!signIn) return;
    try {
      const saved = window.localStorage.getItem(REMEMBERED_CREDENTIALS_KEY);
      if (saved) {
        const credentials = JSON.parse(saved) as { email?: unknown; password?: unknown };
        if (typeof credentials.email !== "string" || typeof credentials.password !== "string") throw new Error("Invalid saved credentials.");
        const initialEmailMatches = !initialEmail || initialEmail.trim().toLowerCase() === credentials.email.trim().toLowerCase();
        if (!initialEmail) setEmail(credentials.email);
        if (initialEmailMatches) {
          setPassword(credentials.password);
          setRememberMe(true);
        }
      }
    } catch {
      // Use the normal empty form when browser storage is unavailable.
    }
  }, [signIn, initialEmail]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!isBusinessEmail(email)) { setError(labels.emailInvalid); return; }
    if (!signIn && !isValidName(nickname)) { setError(labels.nameInvalid); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/auth/${mode === "sign-in" ? "login" : "register"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, nickname, locale, rememberMe }) });
      const data = await response.json() as { ok?: boolean; message?: string; data?: { verificationRequired?: boolean; existingActiveEmail?: boolean; email?: string } };
      if (!response.ok || !data.ok) throw new Error(data.message || "Request failed.");
      if (signIn) rememberCredentials(rememberMe ? { email, password } : null);
      if (data.data?.existingActiveEmail) {
        setExistingNotice(labels.existingEmailNotice);
        setExistingSeconds(3);
        return;
      }
      if (data.data?.verificationRequired) return window.location.assign(`/${locale}/portal/check-email?email=${encodeURIComponent(email.trim().toLowerCase())}`);
      window.location.assign(returnTo || `/${locale}/account/my-learning`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Request failed.");
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!existingNotice) return;
    if (existingSeconds <= 0) { window.location.assign(`/${locale}/portal/sign-in?step=password&email=${encodeURIComponent(email.trim().toLowerCase())}`); return; }
    const timer = window.setTimeout(() => setExistingSeconds(value => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [email, existingNotice, existingSeconds, locale]);

  const switchPath = `${signIn ? `/${locale}/portal/sign-up` : `/${locale}/portal/sign-in`}?returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <form className={`portal-form auth-credential-form ${signIn ? "auth-sign-in" : "auth-sign-up"}`} onSubmit={submit}>
      {showTitle ? <h1>{signIn ? copy.signInTitle : copy.signUpTitle}</h1> : null}
      <div className="auth-fields">
        {!signIn ? <label>{copy.nickname}<span className="auth-input"><User size={20} aria-hidden="true" /><input value={nickname} onChange={(event) => { event.currentTarget.setCustomValidity(""); setNickname(event.target.value); }} onInvalid={(event) => event.currentTarget.setCustomValidity(labels.nameInvalid)} required minLength={1} maxLength={50} autoComplete="name" /></span></label> : null}
        <label>{copy.email}<span className="auth-input"><Mail size={20} aria-hidden="true" /><input type="email" value={email} onChange={(event) => { event.currentTarget.setCustomValidity(""); setEmail(event.target.value); }} onInvalid={(event) => event.currentTarget.setCustomValidity(labels.emailInvalid)} required maxLength={30} autoComplete="email" placeholder="you@example.com" /></span></label>
        <label>{copy.password}<span className="auth-input"><Lock size={20} aria-hidden="true" /><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} maxLength={30} autoComplete={signIn ? "current-password" : "new-password"} /><button className="auth-password-toggle" type="button" aria-label={showPassword ? labels.hidePassword : labels.showPassword} title={showPassword ? labels.hidePassword : labels.showPassword} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button></span></label>
      </div>
      {signIn ? <div className="auth-options"><label><input type="checkbox" checked={rememberMe} onChange={event => { setRememberMe(event.target.checked); if (!event.target.checked) rememberCredentials(null); }} />{labels.rememberMe}</label><a href={`/${locale}/portal/forgot-password?${new URLSearchParams({ email, returnTo })}`}>{copy.forgotPassword}</a></div> : null}
      {error ? <p className="portal-form-error" role="alert">{error}</p> : null}
      {existingNotice ? <div className="portal-success" role="status"><p>{existingNotice}</p><p>{labels.existingEmailCountdown.replace("{seconds}", String(existingSeconds))}</p></div> : null}
      <button className="portal-button portal-button-primary auth-submit" disabled={busy}>{signIn ? copy.submitSignIn : copy.submitSignUp}</button>
      {showTitle ? <a href={switchPath}>{signIn ? copy.noAccount : copy.haveAccount}</a> : null}
      <AuthProviders locale={locale} returnTo={returnTo} copy={copy} googleEnabled={googleEnabled} wechatEnabled={wechatEnabled} />
      {showTitle ? <a href={`/${locale}/portal`}>{copy.backToPortal}</a> : null}
    </form>
  );
}

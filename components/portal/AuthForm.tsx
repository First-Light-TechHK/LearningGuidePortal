"use client";

import { FormEvent, useEffect, useState } from "react";
import { Check, Eye, EyeOff, Lock, Mail, User, X } from "lucide-react";
import { getMessages } from "@/lib/i18n/messages";
import { AuthProviders } from "@/components/portal/AuthProviders";
import { isBusinessEmail, isEmailTooLong } from "@/lib/emailValidation";
import { isNameTooLong, isValidName } from "@/lib/nameValidation";

const REMEMBERED_CREDENTIALS_KEY = "learning-guide.remembered-credentials";
const REMEMBERED_CREDENTIALS_MAX_AGE_MS = 30 * 60 * 1000;

function rememberCredentials(credentials: { email: string; password: string } | null) {
  try {
    if (credentials) window.localStorage.setItem(REMEMBERED_CREDENTIALS_KEY, JSON.stringify({
      email: credentials.email.trim(),
      password: credentials.password,
      expiresAt: Date.now() + REMEMBERED_CREDENTIALS_MAX_AGE_MS
    }));
    else window.localStorage.removeItem(REMEMBERED_CREDENTIALS_KEY);
  } catch {
    // Storage may be disabled; signing in must still work.
  }
}

export function AuthForm({ locale, mode, copy, returnTo, googleEnabled, wechatEnabled, providerError, showTitle = true, initialEmail = "", signupDesign = false }: { locale: "en-GB" | "zh-CN"; mode: "sign-in" | "sign-up"; copy: { signInTitle: string; signUpTitle: string; email: string; password: string; nickname: string; fullName: string; submitSignIn: string; submitSignUp: string; noAccount: string; haveAccount: string; checkEmailSignIn: string; backToPortal: string; forgotPassword: string; or: string; google: string; wechat: string; existingEmailNotice: string; existingEmailCountdown: string; keepSignedIn: string; joinForFree: string; fullNamePlaceholder: string; createPassword: string; passwordHint: string; signUpTermsPrefix: string; signUpTermsAnd: string; termsOfUse: string; privacyNotice: string; closeSignUp: string; socialSignUpWith: string }; returnTo: string; googleEnabled?: boolean; wechatEnabled?: boolean; providerError?: string; showTitle?: boolean; initialEmail?: string; signupDesign?: boolean }) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState(providerError || "");
  const [existingNotice, setExistingNotice] = useState("");
  const [existingSeconds, setExistingSeconds] = useState(3);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const labels = getMessages(locale).auth;
  const signIn = mode === "sign-in";
  const verifiedEmail = initialEmail.trim().toLowerCase();
  const emailIsConfirmed = signIn && Boolean(verifiedEmail) && email.trim().toLowerCase() === verifiedEmail;

  useEffect(() => {
    if (!signIn) return;
    try {
      const saved = window.localStorage.getItem(REMEMBERED_CREDENTIALS_KEY);
      if (saved) {
        const credentials = JSON.parse(saved) as { email?: unknown; password?: unknown; expiresAt?: unknown };
        if (typeof credentials.email !== "string" || typeof credentials.password !== "string" || typeof credentials.expiresAt !== "number" || !Number.isFinite(credentials.expiresAt) || credentials.expiresAt <= Date.now()) {
          rememberCredentials(null);
          return;
        }
        const initialEmailMatches = !initialEmail || initialEmail.trim().toLowerCase() === credentials.email.trim().toLowerCase();
        if (!initialEmail) setEmail(credentials.email);
        if (initialEmailMatches) {
          setPassword(credentials.password);
          setRememberMe(true);
        }
      }
    } catch {
      // Invalid saved data is removed; unavailable browser storage must not block sign-in.
      rememberCredentials(null);
    }
  }, [signIn, initialEmail]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (isEmailTooLong(email)) { setError(labels.emailTooLong); return; }
    if (!isBusinessEmail(email)) { setError(labels.emailInvalid); return; }
    if (!signIn && isNameTooLong(nickname)) { setError(labels.nameTooLong); return; }
    if (!signIn && !isValidName(nickname)) { setError(labels.nameInvalid); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/auth/${mode === "sign-in" ? "login" : "register"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, nickname, locale, rememberMe }) });
      const data = await response.json() as { ok?: boolean; code?: string; data?: { verificationRequired?: boolean; existingActiveEmail?: boolean; email?: string } };
      if (!response.ok || !data.ok) {
        const message = data.code === "AUTHENTICATION_FAILED" ? labels.authenticationFailed
          : data.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? labels.emailDeliveryNotConfigured
          : data.code === "REGISTRATION_FAILED" ? labels.registrationFailed
          : labels.requestFailed;
        throw new Error(message);
      }
      if (signIn) rememberCredentials(rememberMe ? { email, password } : null);
      if (data.data?.existingActiveEmail) {
        setExistingNotice(labels.existingEmailNotice);
        setExistingSeconds(3);
        return;
      }
      if (data.data?.verificationRequired) return window.location.assign(`/${locale}/portal/check-email?email=${encodeURIComponent(email.trim().toLowerCase())}`);
      window.location.assign(returnTo || `/${locale}/account/my-learning`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : labels.requestFailed);
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
    <form className={`portal-form auth-credential-form ${signIn ? "auth-sign-in auth-password-step" : `auth-sign-up${signupDesign ? " auth-signup-design" : ""}`}`} onSubmit={submit}>
      {signupDesign ? <><header className="auth-signup-header"><div><h1>{copy.joinForFree}</h1><a className="auth-signup-close" href={`/${locale}/portal`} aria-label={copy.closeSignUp} title={copy.closeSignUp}><X size={18} /></a></div><p>{copy.checkEmailSignIn} <a href={switchPath}>{copy.submitSignIn}</a></p></header><div className="auth-signup-divider" /></> : showTitle ? <h1>{signIn ? copy.signInTitle : copy.signUpTitle}</h1> : null}
      <div className="auth-fields">
        {!signIn ? <label><span className="auth-field-label">{signupDesign ? copy.fullName : copy.nickname}</span><span className="auth-input"><User size={20} aria-hidden="true" /><input value={nickname} onChange={(event) => { event.currentTarget.setCustomValidity(""); const value = event.target.value; setNickname(value); if (isNameTooLong(value)) setError(labels.nameTooLong); else if (error === labels.nameTooLong) setError(""); }} onInvalid={(event) => event.currentTarget.setCustomValidity(labels.nameInvalid)} required minLength={1} autoComplete="name" placeholder={signupDesign ? copy.fullNamePlaceholder : undefined} /></span></label> : null}
        <label><span className="auth-field-label">{copy.email}</span><span className="auth-input"><Mail size={20} aria-hidden="true" /><input type="email" value={email} onChange={(event) => { event.currentTarget.setCustomValidity(""); const value = event.target.value; setEmail(value); if (isEmailTooLong(value)) setError(labels.emailTooLong); else if (error === labels.emailTooLong) setError(""); }} onInvalid={(event) => event.currentTarget.setCustomValidity(isEmailTooLong(event.currentTarget.value) ? labels.emailTooLong : labels.emailInvalid)} required autoComplete="email" placeholder="you@example.com" />{emailIsConfirmed ? <span className="auth-email-confirmed" aria-hidden="true"><Check size={11} strokeWidth={3} /></span> : null}</span></label>
        <label><span className="auth-field-label">{copy.password}</span>{signupDesign ? <span className="auth-password-hint">{copy.passwordHint}</span> : null}<span className="auth-input"><Lock size={20} aria-hidden="true" /><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} maxLength={signIn ? 30 : 72} autoComplete={signIn ? "current-password" : "new-password"} placeholder={signupDesign ? copy.createPassword : undefined} /><button className="auth-password-toggle" type="button" aria-label={showPassword ? labels.hidePassword : labels.showPassword} title={showPassword ? labels.hidePassword : labels.showPassword} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button></span></label>
      </div>
      {signIn ? <div className="auth-options"><label><input type="checkbox" checked={rememberMe} onChange={event => { setRememberMe(event.target.checked); if (!event.target.checked) rememberCredentials(null); }} />{copy.keepSignedIn}</label><a href={`/${locale}/portal/forgot-password?${new URLSearchParams({ email, returnTo })}`}>{copy.forgotPassword}</a></div> : null}
      {signupDesign ? <label className="auth-signup-terms"><input type="checkbox" checked={termsAccepted} onChange={event => setTermsAccepted(event.target.checked)} /><span>{copy.signUpTermsPrefix} <strong>{copy.termsOfUse}</strong> {copy.signUpTermsAnd} <strong>{copy.privacyNotice}</strong>.</span></label> : null}
      {error ? <p className="portal-form-error" role="alert">{error}</p> : null}
      {existingNotice ? <div className="portal-success" role="status"><p>{existingNotice}</p><p>{labels.existingEmailCountdown.replace("{seconds}", String(existingSeconds))}</p></div> : null}
      <button className="portal-button portal-button-primary auth-submit" disabled={busy}>{signupDesign ? copy.joinForFree : signIn ? copy.submitSignIn : copy.submitSignUp}</button>
      {showTitle ? <a href={switchPath}>{signIn ? copy.noAccount : copy.haveAccount}</a> : null}
      {signupDesign ? <div className="auth-signup-divider" /> : null}
      <AuthProviders locale={locale} returnTo={returnTo} copy={copy} googleEnabled={googleEnabled} wechatEnabled={wechatEnabled} wechatFirst={signIn} variant={signIn ? "signin" : signupDesign ? "buttons" : "icons"} />
      {showTitle ? <a href={`/${locale}/portal`}>{copy.backToPortal}</a> : null}
    </form>
  );
}

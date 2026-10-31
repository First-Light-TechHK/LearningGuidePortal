"use client";

import { PortalProvider } from "./ui/PortalProvider";

import { Input } from "antd";
import { PortalButton } from "./ui/PortalButton";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { Check, Eye, EyeOff, Lock, Mail, User, X } from "lucide-react";
import { getMessages } from "@/lib/i18n/messages";
import { AuthProviders } from "@/components/portal/AuthProviders";
import { isBusinessEmail, isEmailTooLong } from "@/lib/emailValidation";
import { isNameTooLong, isValidAccountName } from "@/lib/nameValidation";

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

export function AuthForm(props: Parameters<typeof AuthFormContent>[0]) {
  return <PortalProvider locale={props.locale}><AuthFormContent {...props}/></PortalProvider>;
}

function AuthFormContent({ locale, mode, copy, returnTo, googleEnabled, wechatEnabled, providerError, showTitle = true, initialEmail = "", signupDesign = false }: { locale: "en-GB" | "zh-CN"; mode: "sign-in" | "sign-up"; copy: { signInTitle: string; signUpTitle: string; email: string; password: string; nickname: string; fullName: string; submitSignIn: string; submitSignUp: string; noAccount: string; haveAccount: string; checkEmailSignIn: string; backToPortal: string; forgotPassword: string; or: string; google: string; wechat: string; existingEmailNotice: string; existingEmailCountdown: string; keepSignedIn: string; joinForFree: string; fullNamePlaceholder: string; createPassword: string; passwordHint: string; signUpTermsPrefix: string; signUpTermsAnd: string; termsOfUse: string; privacyNotice: string; closeSignUp: string; socialSignUpWith: string }; returnTo: string; googleEnabled?: boolean; wechatEnabled?: boolean; providerError?: string; showTitle?: boolean; initialEmail?: string; signupDesign?: boolean }) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState(providerError || "");
  const [existingNotice, setExistingNotice] = useState("");
  const [existingSeconds, setExistingSeconds] = useState(3);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const termsCheckbox = useRef<HTMLInputElement>(null), errorId = useId();
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

  function hasRegistrationConsent() {
    if (signIn || termsAccepted) return true;
    setError(labels.registrationConsentRequired);
    termsCheckbox.current?.focus();
    return false;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    setError("");
    if (!hasRegistrationConsent()) return;
    if (isEmailTooLong(email)) { setError(labels.emailTooLong); return; }
    if (!isBusinessEmail(email)) { setError(labels.emailInvalid); return; }
    if (!signIn && isNameTooLong(nickname)) { setError(labels.nameTooLong); return; }
    if (!signIn && !isValidAccountName(nickname)) { setError(labels.nameInvalid); return; }
    submitting.current = true;
    setBusy(true);
    try {
      const response = await fetch(`/api/auth/${mode === "sign-in" ? "login" : "register"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, nickname, locale, rememberMe, ...(!signIn ? { termsAccepted } : {}) }) });
      const data = await response.json() as { ok?: boolean; code?: string; data?: { verificationRequired?: boolean; existingActiveEmail?: boolean; email?: string } };
      if (!response.ok || !data.ok) {
        const message = data.code === "REGISTRATION_CONSENT_REQUIRED" ? labels.registrationConsentRequired
          : data.code === "AUTHENTICATION_FAILED" ? labels.authenticationFailed
          : data.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? labels.emailDeliveryNotConfigured
          : data.code === "REGISTRATION_FAILED" ? labels.registrationFailed
          : labels.requestFailed;
        throw new Error(message);
      }
      if (signIn) rememberCredentials(rememberMe ? { email, password } : null);
      if (data.data?.existingActiveEmail) {
        setExistingNotice(labels.existingEmailNotice);
        setExistingSeconds(3);
        submitting.current = false;
        setBusy(false);
        return;
      }
      if (data.data?.verificationRequired) return window.location.assign(`/${locale}/portal/check-email?email=${encodeURIComponent(email.trim().toLowerCase())}`);
      window.location.assign(returnTo || `/${locale}/account/my-learning`);
    } catch (requestError) {
      submitting.current = false;
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
        {!signIn ? <label><span className="auth-field-label">{signupDesign ? copy.fullName : copy.nickname}</span><span className="auth-input"><User size={20} aria-hidden="true" /><Input onInput={event => event.currentTarget.setCustomValidity("")} value={nickname} onChange={(event) => { const value = event.target.value; setNickname(value); if (isNameTooLong(value)) setError(labels.nameTooLong); else if (error === labels.nameTooLong) setError(""); }} onInvalid={(event) => event.currentTarget.setCustomValidity(labels.nameInvalid)} required minLength={1} autoComplete="name" placeholder={signupDesign ? copy.fullNamePlaceholder : undefined} /></span></label> : null}
        <label><span className="auth-field-label">{copy.email}</span><span className="auth-input"><Mail size={20} aria-hidden="true" /><Input onInput={event => event.currentTarget.setCustomValidity("")} type="email" value={email} onChange={(event) => { const value = event.target.value; setEmail(value); if (isEmailTooLong(value)) setError(labels.emailTooLong); else if (error === labels.emailTooLong) setError(""); }} onInvalid={(event) => event.currentTarget.setCustomValidity(isEmailTooLong(event.currentTarget.value) ? labels.emailTooLong : labels.emailInvalid)} required autoComplete="email" placeholder="you@example.com" />{emailIsConfirmed ? <span className="auth-email-confirmed" aria-hidden="true"><Check size={11} strokeWidth={3} /></span> : null}</span></label>
        <label><span className="auth-field-label">{copy.password}</span>{signupDesign ? <span className="auth-password-hint">{copy.passwordHint}</span> : null}<span className="auth-input"><Lock size={20} aria-hidden="true" /><Input onInput={event => event.currentTarget.setCustomValidity("")} type={showPassword ? "text" : "password"} value={password} onChange={(event) => { setPassword(event.target.value); }} onInvalid={event => { const input = event.currentTarget; input.setCustomValidity(input.validity.valueMissing ? labels.passwordRequired : input.validity.tooLong ? labels.passwordTooLong.replace("{max}", String(input.maxLength)) : labels.passwordTooShort); }} required minLength={8} maxLength={signIn ? 30 : 72} autoComplete={signIn ? "current-password" : "new-password"} placeholder={signupDesign ? copy.createPassword : undefined} /><button className="auth-password-toggle" type="button" aria-label={showPassword ? labels.hidePassword : labels.showPassword} title={showPassword ? labels.hidePassword : labels.showPassword} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button></span></label>
      </div>
      {signIn ? <div className="auth-options"><label><input type="checkbox" checked={rememberMe} onChange={event => { setRememberMe(event.target.checked); if (!event.target.checked) rememberCredentials(null); }} />{copy.keepSignedIn}</label><a href={`/${locale}/portal/forgot-password?${new URLSearchParams({ email, returnTo })}`}>{copy.forgotPassword}</a></div> : null}
      {!signIn ? <label className="auth-signup-terms"><input ref={termsCheckbox} type="checkbox" name="termsAccepted" required checked={termsAccepted} aria-invalid={error === labels.registrationConsentRequired || undefined} aria-describedby={error === labels.registrationConsentRequired ? errorId : undefined} onInvalid={event => { event.currentTarget.setCustomValidity(labels.registrationConsentRequired); setError(labels.registrationConsentRequired); }} onChange={event => { setTermsAccepted(event.target.checked); if (error === labels.registrationConsentRequired) setError(""); }} /><span>{copy.signUpTermsPrefix} <strong>{copy.termsOfUse}</strong> {copy.signUpTermsAnd} <strong>{copy.privacyNotice}</strong>.</span></label> : null}
      {error ? <p id={errorId} className="portal-form-error" role="alert">{error}</p> : null}
      {existingNotice ? <div className="portal-success" role="status"><p>{existingNotice}</p><p>{labels.existingEmailCountdown.replace("{seconds}", String(existingSeconds))}</p></div> : null}
      <PortalButton className="auth-submit" type="primary" htmlType="submit" loading={busy} disabled={busy} onClick={event => { if (!hasRegistrationConsent()) event.preventDefault(); }}>{signupDesign ? copy.joinForFree : signIn ? copy.submitSignIn : copy.submitSignUp}</PortalButton>
      {showTitle ? <a href={switchPath}>{signIn ? copy.noAccount : copy.haveAccount}</a> : null}
      {signupDesign ? <div className="auth-signup-divider" /> : null}
      <AuthProviders locale={locale} returnTo={returnTo} copy={copy} googleEnabled={googleEnabled} wechatEnabled={wechatEnabled} disabled={!signIn && (!termsAccepted || busy)} wechatFirst={signIn} variant={signIn ? "signin" : signupDesign ? "buttons" : "icons"} />
      {showTitle ? <a href={`/${locale}/portal`}>{copy.backToPortal}</a> : null}
    </form>
  );
}

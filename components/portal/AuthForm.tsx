"use client";

import { FormEvent, useState } from "react";

export function AuthForm({ locale, mode, copy, returnTo, googleEnabled, wechatEnabled, providerError, showTitle = true, initialEmail = "" }: { locale: "en-GB" | "zh-CN"; mode: "sign-in" | "sign-up"; copy: { signInTitle: string; signUpTitle: string; email: string; password: string; nickname: string; submitSignIn: string; submitSignUp: string; noAccount: string; haveAccount: string; backToPortal: string; forgotPassword: string; or: string; google: string; wechat: string }; returnTo: string; googleEnabled?: boolean; wechatEnabled?: boolean; providerError?: string; showTitle?: boolean; initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState(providerError || "");
  const [busy, setBusy] = useState(false);
  const signIn = mode === "sign-in";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/auth/${mode === "sign-in" ? "login" : "register"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, nickname, locale }) });
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
    <form className="portal-form" onSubmit={submit}>
      {showTitle ? <h1>{signIn ? copy.signInTitle : copy.signUpTitle}</h1> : null}
      {!signIn ? <label>{copy.nickname}<input value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={40} /></label> : null}
      <label>{copy.email}<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label>
      <label>{copy.password}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete={signIn ? "current-password" : "new-password"} /></label>
      {error ? <p className="portal-form-error" role="alert">{error}</p> : null}
      <button className="portal-button portal-button-primary" disabled={busy}>{busy ? "..." : signIn ? copy.submitSignIn : copy.submitSignUp}</button>
      <a href={switchPath}>{signIn ? copy.noAccount : copy.haveAccount}</a>
      {signIn ? <a href={`/${locale}/portal/forgot-password`}>{copy.forgotPassword}</a> : null}
      {googleEnabled || wechatEnabled ? <div className="auth-provider-options"><span>{copy.or}</span>{googleEnabled ? <a className="portal-button portal-button-secondary" href={`/api/auth/google?locale=${locale}&returnTo=${encodeURIComponent(returnTo)}`}>{copy.google}</a> : null}{wechatEnabled ? <a className="portal-button portal-button-secondary" href={`/api/auth/wechat?locale=${locale}&returnTo=${encodeURIComponent(returnTo)}`}>{copy.wechat}</a> : null}</div> : null}
      <a href={`/${locale}/portal`}>{copy.backToPortal}</a>
    </form>
  );
}

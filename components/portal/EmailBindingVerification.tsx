"use client";
import { useEffect, useRef, useState } from "react";
import { getMessages } from "@/lib/i18n/messages";

export function EmailBindingVerification({ token, locale, returnTo }: { token: string; locale: "en-GB" | "zh-CN"; returnTo: string }) {
  const copy = getMessages(locale).auth;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(token ? "" : copy.bindingInvalid);
  const [result, setResult] = useState<{ sameUser: boolean; continueUrl: string } | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (token && !started.current) { started.current = true; void verify(); }
  }, [token]);
  async function verify() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/email-binding/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, locale, returnTo }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.code === "email_in_use" ? copy.bindingEmailInUse : copy.bindingInvalid);
      setResult(data);
      window.history.replaceState({}, "", window.location.pathname + "?returnTo=" + encodeURIComponent(returnTo));
    } catch (error) { setError(error instanceof Error ? error.message : copy.bindingInvalid); }
    finally { setBusy(false); }
  }
  return <section className="portal-form"><h1>{copy.bindingVerify}</h1>
    {result ? <><p role="status">{result.sameUser ? copy.bindingSuccess : copy.bindingOtherDevice}</p><a className="portal-button portal-button-primary" href={result.continueUrl}>{result.sameUser ? copy.bindingContinue : copy.wechat}</a></> : <><p>{copy.bindingVerifyDescription}</p>{error ? <p className="portal-form-error" role="alert">{error}</p> : null}{token ? <button className="portal-button portal-button-primary" disabled={busy} onClick={() => void verify()}>{busy ? "..." : copy.bindingVerifyAction}</button> : null}<a href={`/${locale}/portal/bind-email?returnTo=${encodeURIComponent(returnTo)}`}>{copy.bindingTitle}</a></>}
  </section>;
}

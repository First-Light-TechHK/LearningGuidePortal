"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getMessages } from "@/lib/i18n/messages";

export function EmailBindingForm({ locale, returnTo }: { locale: "en-GB" | "zh-CN"; returnTo: string }) {
  const copy = getMessages(locale).auth;
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  useEffect(() => { if (!seconds) return; const timer = setTimeout(() => setSeconds(value => value - 1), 1000); return () => clearTimeout(timer); }, [seconds]);
  useEffect(() => { if (!sent) return; const timer = setInterval(() => router.refresh(), 5000); return () => clearInterval(timer); }, [sent, router]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/email-binding/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, locale, returnTo }) });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        if (data.code === "already_bound") { router.refresh(); return; }
        if (data.code === "cooldown") setSeconds(60);
        throw new Error(data.code === "email_in_use" ? copy.bindingEmailInUse : data.code === "cooldown" ? copy.bindingCooldown : response.status === 401 ? copy.bindingSignIn : copy.bindingError);
      }
      setSent(true); setSeconds(60);
    } catch (error) { setError(error instanceof Error ? error.message : copy.bindingError); }
    finally { setBusy(false); }
  }
  async function exit() { await fetch("/api/auth/logout", { method: "POST" }); window.location.assign(`/${locale}/portal/sign-in?returnTo=${encodeURIComponent(returnTo)}`); }
  return <form className="portal-form" onSubmit={submit}><h1>{sent ? copy.checkEmailTitle : copy.bindingTitle}</h1><p>{sent ? copy.bindingSent : copy.bindingDescription}</p>
    {sent ? <p role="status">{email}</p> : <label>{copy.email}<input type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>}
    {error ? <p role="alert" className="portal-form-error">{error}</p> : null}
    <button className="portal-button portal-button-primary" disabled={busy || seconds > 0}>{busy ? "..." : sent ? copy.bindingResend : copy.bindingSend}</button>
    {seconds > 0 ? <p role="status">{copy.resetWait.replace("{seconds}", String(seconds))}</p> : null}
    {sent ? <button type="button" className="portal-text-button" onClick={() => { setSent(false); setError(""); }}>{copy.bindingChange}</button> : null}
    <button type="button" className="portal-text-button" onClick={() => void exit()}>{copy.bindingExit}</button>
  </form>;
}

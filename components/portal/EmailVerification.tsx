"use client";

import { useEffect, useRef, useState } from "react";

type Copy = { verifyEmail: string; verifyPending: string; verifySuccess: string; verifyInvalid: string; submitSignIn: string; registrationSuccess: string; registrationSuccessCountdown: string };

export function EmailVerification({ token, verifiedEmail = "", locale, copy, returnTo = `/${locale}/portal` }: { token: string; verifiedEmail?: string; locale: "en-GB" | "zh-CN"; copy: Copy; returnTo?: string }) {
  const started = useRef(false);
  const [state, setState] = useState<"loading" | "success" | "error">(verifiedEmail ? "success" : token ? "loading" : "error");
  const [message, setMessage] = useState(verifiedEmail ? copy.registrationSuccess : token ? copy.verifyPending : copy.verifyInvalid);
  const [email, setEmail] = useState(verifiedEmail);
  const [seconds, setSeconds] = useState(1);
  useEffect(() => {
    if (verifiedEmail || !token || started.current) return;
    started.current = true;
    window.history.replaceState({}, "", `${window.location.pathname}?returnTo=${encodeURIComponent(returnTo)}`);
    void (async () => {
      try {
        const response = await fetch("/api/auth/verify-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
        const result = await response.json() as { ok?: boolean; message?: string; data?: { user?: { email?: string | null } } };
        if (!response.ok || !result.ok) throw new Error(result.message || copy.verifyInvalid);
        setEmail(result.data?.user?.email || ""); setState("success"); setMessage(copy.registrationSuccess);
      } catch { setState("error"); setMessage(copy.verifyInvalid); }
    })();
  }, [copy.registrationSuccess, copy.verifyInvalid, copy.verifySuccess, token, verifiedEmail, returnTo]);
  useEffect(() => { if (state !== "success") return; if (seconds <= 0) { window.location.assign(`/${locale}/portal/sign-in?step=password&email=${encodeURIComponent(email)}&returnTo=${encodeURIComponent(returnTo)}`); return; } const timer = window.setTimeout(() => setSeconds(value => value - 1), 1000); return () => window.clearTimeout(timer); }, [email, locale, seconds, state, returnTo]);
  return <section className="portal-form"><h1>{copy.verifyEmail}</h1><p className={state === "error" ? "portal-form-error" : state === "success" ? "portal-success" : undefined} role="status">{message}</p>{state === "success" ? <p role="status">{copy.registrationSuccessCountdown.replace("{seconds}", String(seconds))}</p> : null}{state === "error" ? <a className="portal-button portal-button-primary" href={`/${locale}/portal/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>{copy.submitSignIn}</a> : null}</section>;
}

"use client";

import { useEffect, useRef, useState } from "react";

type Copy = { verifyEmail: string; verifyPending: string; verifySuccess: string; verifyInvalid: string; submitSignIn: string };

export function EmailVerification({ token, locale, copy }: { token: string; locale: "en-GB" | "zh-CN"; copy: Copy }) {
  const started = useRef(false);
  const [state, setState] = useState<"loading" | "success" | "error">(token ? "loading" : "error");
  const [message, setMessage] = useState(token ? copy.verifyPending : copy.verifyInvalid);
  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    window.history.replaceState({}, "", window.location.pathname);
    void (async () => {
      try {
        const response = await fetch("/api/auth/verify-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
        const result = await response.json() as { ok?: boolean; message?: string };
        if (!response.ok || !result.ok) throw new Error(result.message || copy.verifyInvalid);
        setState("success"); setMessage(copy.verifySuccess);
      } catch { setState("error"); setMessage(copy.verifyInvalid); }
    })();
  }, [copy.verifyInvalid, copy.verifySuccess, token]);
  return <section className="portal-form"><h1>{copy.verifyEmail}</h1><p className={state === "error" ? "portal-form-error" : state === "success" ? "portal-success" : undefined} role="status">{message}</p>{state !== "loading" ? <a className="portal-button portal-button-primary" href={`/${locale}/portal/sign-in`}>{copy.submitSignIn}</a> : null}</section>;
}

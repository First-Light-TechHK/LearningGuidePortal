"use client";

import { useState } from "react";

type Copy = {
  complete: string;
  fail: string;
  cancel: string;
  processing: string;
  error: string;
};

export function LocalCheckout({ orderId, quoteId, locale, copy }: { orderId: string; quoteId: string; locale: "en-GB" | "zh-CN"; copy: Copy }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(action: "complete" | "fail" | "cancel") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/purchase/demo/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, action }) });
      const data = await response.json() as { ok?: boolean; error?: string; status?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || copy.error);
      window.location.assign(action === "complete"
        ? `/${locale}/portal/payment/success?orderId=${encodeURIComponent(orderId)}`
        : `/${locale}/portal/subscription/confirmation?quoteId=${encodeURIComponent(quoteId)}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.error);
      setBusy(false);
    }
  }

  return <div className="local-checkout-actions"><button className="portal-button portal-button-primary" disabled={busy} type="button" onClick={() => void submit("complete")}>{busy ? copy.processing : copy.complete}</button><div className="local-checkout-secondary-actions"><button className="portal-button portal-button-secondary" disabled={busy} type="button" onClick={() => void submit("fail")}>{copy.fail}</button><button className="portal-button portal-button-secondary" disabled={busy} type="button" onClick={() => void submit("cancel")}>{copy.cancel}</button></div>{error ? <p className="portal-form-error" role="alert">{error}</p> : null}</div>;
}

"use client";

import { useState } from "react";
import { getMessages } from "@/lib/i18n/messages";

export function UpgradePanel({ locale, subscriptionId }: { locale: "en-GB" | "zh-CN"; subscriptionId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const copy = getMessages(locale).upgradePanel;

  async function begin() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/subscription/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "upgrade", subscriptionId }) });
      const data = await response.json() as { quote?: { id: string }; error?: string };
      if (!response.ok || !data.quote) throw new Error(data.error || copy.error);
      window.location.assign(`/${locale}/portal/subscription/confirmation?quoteId=${encodeURIComponent(data.quote.id)}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.error);
      setBusy(false);
    }
  }

  return <section className="pricing-upgrade-panel"><p className="portal-eyebrow">{copy.eyebrow}</p><h2>{copy.title}</h2><p>{copy.description}</p>{error ? <p className="portal-form-error" role="alert">{error}</p> : null}<button className="portal-button portal-button-primary" type="button" onClick={() => void begin()} disabled={busy}>{copy.calculate}</button></section>;
}

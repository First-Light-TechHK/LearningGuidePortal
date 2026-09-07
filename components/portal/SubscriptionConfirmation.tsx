"use client";

import { useState } from "react";

type Quote = { id: string; kind?: "purchase" | "trial" | "upgrade"; amountMinor: number; currency: string; creditMinor?: number };
type Plan = { id: string; name: string; termMonths: number; device: "pc" | "mobile"; amountMinor: number; currency: string; aiPoints?: number };

type Copy = {
  eyebrow: string; title: string; description: string; plan: string; scope: string; device: string; term: string; aiPoints: string;
  pcDevice: string; mobileDevice: string; amount: string; trialAmount: string; consentRenewal: string; consentTerms: string;
  consentRefund: string; continue: string; expired: string; processing: string;
};

export function SubscriptionConfirmation({ locale, quote, plan, copy }: { locale: "en-GB" | "zh-CN"; quote: Quote; plan: Plan; copy: Copy }) {
  const [renewal, setRenewal] = useState(false);
  const [terms, setTerms] = useState(false);
  const [refund, setRefund] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isTrial = quote.kind === "trial";

  async function submit() {
    if (!renewal || !terms || !refund) return;
    setBusy(true); setError("");
    try {
      const endpoint = isTrial ? "/api/trial" : "/api/purchase/checkout";
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteId: quote.id, locale, consents: { renewal: true, terms: true, refund: true } }) });
      const data = await response.json() as { checkoutUrl?: string; error?: string };
      if (response.status === 401) { window.location.assign(`/${locale}/portal/sign-in?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`); return; }
      if (!response.ok || !data.checkoutUrl) throw new Error(data.error || "Checkout could not be prepared.");
      window.location.assign(data.checkoutUrl);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Checkout could not be prepared.");
      setBusy(false);
    }
  }

  return <section className="portal-section portal-section-first subscription-confirmation">
    <p className="portal-eyebrow">{copy.eyebrow}</p>
    <h1>{copy.title}</h1>
    <p className="portal-lead">{copy.description}</p>
    <div className="subscription-confirmation-summary">
      <div><span>{copy.plan}</span><strong>{plan.name}</strong></div>
      <div><span>{copy.scope}</span><strong>{plan.device === "pc" ? copy.pcDevice : copy.mobileDevice}</strong></div>
      <div><span>{copy.term}</span><strong>{plan.termMonths} months</strong></div>
      <div><span>{copy.aiPoints}</span><strong>{plan.aiPoints ?? 0}</strong></div>
      <div><span>{copy.amount}</span><strong>{isTrial ? copy.trialAmount : `${(quote.amountMinor / 100).toFixed(2)} ${quote.currency.toUpperCase()}`}</strong></div>
    </div>
    <div className="subscription-consents">
      <label><input type="checkbox" checked={renewal} onChange={(event) => setRenewal(event.target.checked)} />{copy.consentRenewal}</label>
      <label><input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} />{copy.consentTerms}</label>
      <label><input type="checkbox" checked={refund} onChange={(event) => setRefund(event.target.checked)} />{copy.consentRefund}</label>
    </div>
    {error ? <p className="portal-form-error" role="alert">{error}</p> : null}
    <button className="portal-button portal-button-primary" type="button" disabled={!renewal || !terms || !refund || busy} onClick={() => void submit()}>{busy ? copy.processing : copy.continue}</button>
  </section>;
}

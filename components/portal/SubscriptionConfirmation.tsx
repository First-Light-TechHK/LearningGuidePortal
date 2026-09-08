"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, ArrowRight } from "lucide-react";

type Quote = { id: string; kind?: "purchase" | "trial" | "upgrade"; amountMinor: number; currency: string; creditMinor?: number };
type Plan = { id: string; name: string; termMonths: number; device: "pc" | "mobile"; amountMinor: number; currency: string; aiPoints?: number };

type Copy = {
  eyebrow: string; title: string; description: string; plan: string; scope: string; device: string; term: string; aiPoints: string;
  pcDevice: string; mobileDevice: string; amount: string; trialAmount: string; consentRenewal: string; consentTerms: string;
  consentRefund: string; continue: string; expired: string; processing: string;
  cancel: string; close: string; selectedPlan: string; paymentRenewal: string; confirmations: string; months: string;
};

export function SubscriptionConfirmation({ locale, quote, plan, copy }: { locale: "en-GB" | "zh-CN"; quote: Quote; plan: Plan; copy: Copy }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [renewal, setRenewal] = useState(false);
  const [terms, setTerms] = useState(false);
  const [refund, setRefund] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isTrial = quote.kind === "trial";
  const dismiss = () => router.replace(`/${locale}/pricing?planId=${encodeURIComponent(plan.id)}`);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { element.close(); document.body.style.overflow = overflow; };
  }, []);

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

  return <dialog ref={dialog} className="subscription-confirmation" aria-labelledby="subscription-confirmation-title" aria-describedby="subscription-confirmation-intro" onCancel={(event) => { event.preventDefault(); if (!busy) dismiss(); }}>
    <header className="confirmation-heading">
      <div><h1 id="subscription-confirmation-title">{copy.title}</h1><p id="subscription-confirmation-intro">{copy.description}</p></div>
      <button className="confirmation-close" type="button" aria-label={copy.close} title={copy.close} onClick={dismiss} disabled={busy}><X size={24} aria-hidden="true" /></button>
    </header>
    <section className="confirmation-plan" aria-label={copy.selectedPlan}>
      <p className="confirmation-label">{copy.selectedPlan}</p><h2>{plan.name}</h2>
      <p>{plan.device === "pc" ? copy.pcDevice : copy.mobileDevice}</p>
      <p>{(plan.aiPoints ?? 0).toLocaleString(locale)} {copy.aiPoints}</p>
    </section>
    <section className="confirmation-payment" aria-labelledby="confirmation-payment-heading">
      <h2 id="confirmation-payment-heading">{copy.paymentRenewal}</h2>
      <dl className="confirmation-payment-grid">
        <div><dt>{copy.amount}</dt><dd>{isTrial ? copy.trialAmount : `${(quote.amountMinor / 100).toFixed(2)} ${quote.currency.toUpperCase()}`}</dd></div>
        <div><dt>{copy.term}</dt><dd>{plan.termMonths} {copy.months}</dd></div>
      </dl>
      <p className="confirmation-renewal">{copy.consentRenewal}</p>
    </section>
    <fieldset className="subscription-consents"><legend>{copy.confirmations}</legend>
      <label><input type="checkbox" checked={refund} onChange={(event) => setRefund(event.target.checked)} />{copy.consentRefund}</label>
      <label><input type="checkbox" checked={renewal} onChange={(event) => setRenewal(event.target.checked)} />{copy.consentRenewal}</label>
      <label><input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} />{copy.consentTerms}</label>
    </fieldset>
    {error ? <p className="portal-form-error" role="alert">{error}</p> : null}
    <footer className="confirmation-actions"><button className="portal-button portal-button-secondary" type="button" onClick={dismiss} disabled={busy}>{copy.cancel}</button><button className="portal-button portal-button-primary" type="button" disabled={!renewal || !terms || !refund || busy} onClick={() => void submit()}>{busy ? copy.processing : copy.continue}<ArrowRight size={16} aria-hidden="true" /></button></footer>
  </dialog>;
}

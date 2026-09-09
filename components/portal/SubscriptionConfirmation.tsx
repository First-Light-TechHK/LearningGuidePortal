"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, ArrowRight } from "lucide-react";
import { keepFocusInDialog } from "@/lib/dialogFocus";
import { getMessages } from "@/lib/i18n/messages";

type Quote = { id: string; kind?: "purchase" | "trial" | "upgrade"; amountMinor: number; currency: string; creditMinor?: number; sourceSubscriptionId?: string | null };
type Plan = { id: string; name: string; termMonths: number; device: "pc" | "mobile"; amountMinor: number; currency: string; aiPoints?: number };

type Copy = {
  eyebrow: string; title: string; description: string; plan: string; scope: string; device: string; term: string; aiPoints: string;
  pcDevice: string; mobileDevice: string; amount: string; trialAmount: string; consentRenewal: string; consentTerms: string;
  consentRefund: string; continue: string; expired: string; processing: string;
  cancel: string; close: string; selectedPlan: string; paymentRenewal: string; confirmations: string; months: string;
};

export function SubscriptionConfirmation({ locale, quote, plan, copy, planHeading, planSubtitle, scopeDescription, upgradeSource }: { locale: "en-GB" | "zh-CN"; quote: Quote; plan: Plan; copy: Copy; planHeading: string; planSubtitle?: string; scopeDescription: string; upgradeSource?: { name: string; validTo: string } }) {
  const details = getMessages(locale).confirmationDetails;
  const upgrade = getMessages(locale).upgradeConfirmation;
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [renewal, setRenewal] = useState(false);
  const [terms, setTerms] = useState(false);
  const [refund, setRefund] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isTrial = quote.kind === "trial";
  const isUpgrade = quote.kind === "upgrade" && Boolean(upgradeSource);
  const money = (amount: number) => `${new Intl.NumberFormat(locale, { style: "currency", currency: quote.currency, currencyDisplay: "narrowSymbol" }).format(amount / 100)} ${quote.currency.toUpperCase()}`;
  const dismiss = () => router.replace(isUpgrade ? `/${locale}/pricing?upgradeFrom=${encodeURIComponent(quote.sourceSubscriptionId || "")}` : `/${locale}/pricing?planId=${encodeURIComponent(plan.id)}`);
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
      if (!response.ok || !data.checkoutUrl) throw new Error(data.error || details.checkoutError);
      window.location.assign(data.checkoutUrl);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : details.checkoutError);
      setBusy(false);
    }
  }

  return <dialog ref={dialog} className={`subscription-confirmation${isUpgrade ? " upgrade-confirmation" : ""}`} aria-labelledby="subscription-confirmation-title" aria-describedby="subscription-confirmation-intro" onKeyDown={keepFocusInDialog} onCancel={(event) => { event.preventDefault(); if (!busy) dismiss(); }}>
    <header className="confirmation-heading">
      <div><h1 id="subscription-confirmation-title">{isUpgrade ? upgrade.title : copy.title}</h1><p id="subscription-confirmation-intro">{isUpgrade ? upgrade.intro : copy.description}</p></div>
      <button className="confirmation-close" type="button" aria-label={copy.close} title={copy.close} onClick={dismiss} disabled={busy}><X size={24} aria-hidden="true" /></button>
    </header>
    {isUpgrade && upgradeSource ? <>
      <section className="upgrade-summary" aria-label={copy.selectedPlan}><dl>
        <div><dt>{upgrade.source}</dt><dd>{upgradeSource.name}</dd></div>
        <div><dt>{upgrade.target}</dt><dd>{planHeading}</dd></div>
        <div><dt>{copy.term}</dt><dd className="upgrade-validity">{upgrade.validUntil.replace("{date}", new Date(upgradeSource.validTo).toLocaleDateString(locale))}</dd></div>
      </dl><span className="upgrade-art" aria-hidden="true" /></section>
      <section className="upgrade-price" aria-labelledby="upgrade-price-heading"><h2 id="upgrade-price-heading">{upgrade.price}</h2><dl>
        <div><dt>{upgrade.targetPrice}</dt><dd>{money(quote.amountMinor + (quote.creditMinor ?? 0))}</dd></div>
        <div><dt>{upgrade.credit}</dt><dd>{money(quote.creditMinor ?? 0)}</dd></div>
        <div><dt>{upgrade.payToday}</dt><dd>{money(quote.amountMinor)}</dd></div>
      </dl></section>
      <p className="upgrade-other-categories">{upgrade.otherCategories}</p>
    </> : <><section className="confirmation-plan" aria-label={copy.selectedPlan}>
      <p className="confirmation-label">{copy.selectedPlan}</p><h2>{planHeading}{planSubtitle ? <span>{planSubtitle}</span> : null}</h2>
      <div className="confirmation-benefits"><p>{scopeDescription}</p><p>{plan.device === "pc" ? copy.pcDevice : copy.mobileDevice}</p><p>{(plan.aiPoints ?? 0).toLocaleString(locale)} {copy.aiPoints}</p></div>
    </section>
    <section className="confirmation-payment" aria-labelledby="confirmation-payment-heading">
      <h2 id="confirmation-payment-heading">{copy.paymentRenewal}</h2>
      <dl className="confirmation-payment-grid">
        <div><dt>{details.payToday}</dt><dd>{isTrial ? copy.trialAmount : `${new Intl.NumberFormat(locale, {style:"currency", currency:quote.currency, currencyDisplay:"narrowSymbol"}).format(quote.amountMinor / 100)} ${quote.currency.toUpperCase()}`}</dd><p>{isTrial ? details.trialPayment : details.termPayment.replace("{months}", String(plan.termMonths))}</p></div>
        <div><dt>{copy.term}</dt><dd>{plan.termMonths} {copy.months}</dd><p>{isTrial ? details.trialDates : details.datesAfterPayment}</p></div>
      </dl>
      <dl className="confirmation-renewal-grid">
        <div><dt>{details.nextCharge}</dt><dd>{details.billingSchedule}</dd><p>{details.automaticRenewal}</p></div>
        <div><dt>{details.renewalPrice}</dt><dd>{details.applicablePrice}</dd><p>{details.priceNotice}</p></div>
      </dl>
    </section></>}
    <fieldset className="subscription-consents"><legend>{copy.confirmations}</legend>
      <label><input type="checkbox" checked={refund} onChange={(event) => setRefund(event.target.checked)} />{copy.consentRefund}</label>
      <label><input type="checkbox" checked={renewal} onChange={(event) => setRenewal(event.target.checked)} />{copy.consentRenewal}</label>
      <label><input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} />{copy.consentTerms}</label>
    </fieldset>
    {error ? <p className="portal-form-error" role="alert">{error}</p> : null}
    <footer className="confirmation-actions"><button className="portal-button portal-button-secondary" type="button" onClick={dismiss} disabled={busy}>{copy.cancel}</button><button className="portal-button portal-button-primary" type="button" disabled={!renewal || !terms || !refund || busy} onClick={() => void submit()}>{busy ? copy.processing : copy.continue}<ArrowRight size={16} aria-hidden="true" /></button></footer>
  </dialog>;
}

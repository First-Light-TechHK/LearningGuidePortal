"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { keepFocusInDialog } from "@/lib/dialogFocus";
import { getMessages } from "@/lib/i18n/messages";
import type { StripeUpgradeProration } from "@/contracts/stripe-upgrade";
import type { SubscriptionConfirmationDisplay } from "@/contracts/subscription-confirmation";

type Quote = { id: string; kind?: "purchase" | "trial" | "upgrade"; amountMinor: number; currency: string; creditMinor?: number; sourceSubscriptionId?: string | null; upgradeProration?: StripeUpgradeProration };
type Plan = { id: string; name: string; termMonths: number; device: "pc" | "mobile"; amountMinor: number; currency: string; aiPoints?: number };

type Copy = {
  eyebrow: string; title: string; description: string; plan: string; scope: string; device: string; term: string; aiPoints: string;
  pcDevice: string; mobileDevice: string; amount: string; trialAmount: string; consentRenewal: string; consentTerms: string;
  consentRefund: string; continue: string; expired: string; processing: string;
  cancel: string; close: string; selectedPlan: string; paymentRenewal: string; confirmations: string; months: string;
};

export function SubscriptionConfirmation({ locale, quote, plan, copy, planHeading, planSubtitle, scopeDescription, upgradeSource, display }: { locale: "en-GB" | "zh-CN"; quote: Quote; plan: Plan; copy: Copy; planHeading: string; planSubtitle?: string; scopeDescription: string; upgradeSource?: { name: string; validTo: string }; display?: SubscriptionConfirmationDisplay }) {
  const details = getMessages(locale).confirmationDetails;
  const upgrade = getMessages(locale).upgradeConfirmation;
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [renewal, setRenewal] = useState(false);
  const [terms, setTerms] = useState(false);
  const [refund, setRefund] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const isTrial = quote.kind === "trial";
  const isUpgrade = quote.kind === "upgrade" && Boolean(upgradeSource);
  const money = (amount: number) => `${new Intl.NumberFormat(locale, { style: "currency", currency: quote.currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: !isUpgrade && amount % 100 === 0 ? 0 : 2 }).format(amount / 100)} ${quote.currency.toUpperCase()}`;
  const dateLabel = (date: string) => new Date(date).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const source = display?.upgrade;
  const sourceCategory = source?.sourceCategory || upgradeSource?.name || "";
  const renewalDate = source ? dateLabel(source.renewsAt) : details.billingSchedule;
  const remainingDays = source?.remainingDays;
  const everything = display?.planKind === "everything";
  const subtitle = everything ? details.allCategories.replace("{count}", String(display.categoryCount)) : planSubtitle;
  const scopeCopy = everything ? details.everythingAccess.replace("{count}", String(display.categoryCount)) : scopeDescription;
  const points = (plan.aiPoints ?? 0).toLocaleString(locale);
  const consentCopy = isUpgrade ? [upgrade.consentRefund, upgrade.consentRenewal, upgrade.consentSchedule.replace("{date}", renewalDate)] : [copy.consentRefund, copy.consentRenewal, copy.consentTerms];
  const consentFields = [{ checked: refund, setChecked: setRefund }, { checked: renewal, setChecked: setRenewal }, { checked: terms, setChecked: setTerms }];
  const dismiss = () => router.replace(isUpgrade ? `/${locale}/subscription?upgradeFrom=${encodeURIComponent(quote.sourceSubscriptionId || "")}` : `/${locale}/subscription?planId=${encodeURIComponent(plan.id)}`);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    element.focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { element.close(); document.body.style.overflow = overflow; };
  }, []);

  useEffect(() => {
    // Browser back can restore this page from the back-forward cache with the
    // checkout request's busy state still set.
    const restore = () => { submitting.current = false; setBusy(false); };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

  async function submit() {
    if (!renewal || !terms || !refund || submitting.current) return;
    submitting.current = true;
    setBusy(true); setError("");
    try {
      const endpoint = isTrial ? "/api/trial" : "/api/purchase/checkout";
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteId: quote.id, locale, consents: { renewal: true, terms: true, refund: true } }) });
      const data = await response.json() as { checkoutUrl?: string; error?: string; code?: string };
      if (response.status === 401) { window.location.assign(`/${locale}/portal/sign-in?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`); return; }
      if (!response.ok || !data.checkoutUrl) {
        const errors = getMessages(locale).paymentErrors;
        const translated = data.code && Object.hasOwn(errors, data.code) ? errors[data.code as keyof typeof errors] : undefined;
        throw new Error(translated || data.error || details.checkoutError);
      }
      window.location.assign(data.checkoutUrl);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : details.checkoutError);
      submitting.current = false;
      setBusy(false);
    }
  }

  return <dialog ref={dialog} tabIndex={-1} className={`subscription-confirmation${isUpgrade ? " upgrade-confirmation" : ""}`} aria-labelledby="subscription-confirmation-title" aria-describedby="subscription-confirmation-intro" onKeyDown={keepFocusInDialog} onCancel={(event) => { event.preventDefault(); if (!busy) dismiss(); }}>
    <header className="confirmation-heading">
      <h1 id="subscription-confirmation-title">{copy.title}</h1><p id="subscription-confirmation-intro" className={!isUpgrade ? "confirmation-intro-hidden" : undefined}>{isUpgrade ? upgrade.intro : copy.description}</p>
      <button className="confirmation-close" type="button" aria-label={copy.close} title={copy.close} onClick={dismiss} disabled={busy}><Image src="/portal/subscription-confirmation/close.svg" width={20} height={20} alt="" /></button>
    </header>
    {isUpgrade && upgradeSource ? <>
      <p className="confirmation-label">{upgrade.upgradingPlan}</p>
      <section className="upgrade-summary" aria-label={upgrade.upgradingPlan}><div className="upgrade-plan-columns">
        <div className="upgrade-source"><h2>{upgrade.source}</h2><strong>{getMessages(locale).pricingDesign.category}</strong><span>{sourceCategory}</span></div>
        <Image className="upgrade-arrow" src="/portal/subscription-confirmation/upgrade.svg" width={40} height={40} alt="" />
        <div className="upgrade-target"><h2>{upgrade.target}</h2><strong>{planHeading}</strong><p>{upgrade.points.replace("{points}", points).replace("{added}", Math.max(0, (plan.aiPoints ?? 0) - (source?.sourceAiPoints ?? 0)).toLocaleString(locale))}</p></div>
      </div><div className="upgrade-validity"><h2>{upgrade.validDate}</h2><p>{upgrade.retainDate}</p><p>{upgrade.validUntil.replace("{date}", dateLabel(source?.validUntil || upgradeSource.validTo))}</p></div></section>
      <section className="upgrade-price" aria-labelledby="upgrade-price-heading"><h2 id="upgrade-price-heading">{upgrade.price}</h2><dl>
        <div><dt>{remainingDays != null ? upgrade.remainingDays.replace("{days}", String(remainingDays)) : quote.upgradeProration ? upgrade.remainingPrice : upgrade.targetPrice}</dt><dd>+ {money(quote.upgradeProration?.debitMinor ?? plan.amountMinor)}</dd><Image className="upgrade-price-divider" src="/portal/subscription-confirmation/divider.svg" width={656} height={1} alt="" /></div>
        <div><dt>{remainingDays != null ? upgrade.creditDays.replace("{category}", sourceCategory).replace("{days}", String(remainingDays)) : upgrade.credit}</dt><dd>− {money(quote.upgradeProration?.creditMinor ?? quote.creditMinor ?? 0)}</dd><Image className="upgrade-price-divider" src="/portal/subscription-confirmation/divider-credit.svg" width={656} height={1} alt="" /></div>
        {Boolean(quote.upgradeProration?.adjustmentsMinor) && <div><dt>{upgrade.adjustments}</dt><dd>{money(quote.upgradeProration!.adjustmentsMinor)}</dd></div>}
        <div className="upgrade-total"><dt>{upgrade.payToday}</dt><dd>{money(quote.amountMinor)}</dd></div>
      </dl></section>
    </> : <><p className="confirmation-label">{copy.selectedPlan}</p><section className="confirmation-plan" aria-label={copy.selectedPlan}>
      <h2>{planHeading}</h2>{subtitle ? <span className="confirmation-plan-chip">{subtitle}</span> : null}
      <div className="confirmation-benefits"><p>{scopeCopy}</p><p>{plan.device === "pc" ? copy.pcDevice : copy.mobileDevice}{locale === "en-GB" ? "." : "。"}</p><p>{points} {copy.aiPoints}</p></div>
    </section>
    <section className="confirmation-payment" aria-labelledby="confirmation-payment-heading">
      <h2 id="confirmation-payment-heading">{copy.paymentRenewal}</h2>
      <dl className="confirmation-payment-grid">
        <div><dt>{details.payToday}</dt><dd>{isTrial ? copy.trialAmount : money(quote.amountMinor)}</dd><p>{isTrial ? details.trialPayment : details.termPayment.replace("{months}", String(plan.termMonths))}</p></div>
        <div><dt>{copy.term}</dt><dd>{plan.termMonths} {copy.months}</dd><p>{isTrial ? details.trialDates : display?.schedule ? details.estimatedDates.replace("{dates}", `${dateLabel(display.schedule.startsAt)} – ${dateLabel(display.schedule.endsAt)}`) : details.datesAfterPayment}</p></div>
      </dl>
      <dl className="confirmation-renewal-grid">
        <div><dt>{details.nextCharge}</dt><dd>{display?.schedule ? dateLabel(display.schedule.renewsAt) : details.billingSchedule}</dd><p>{details.automaticRenewal}</p></div>
        <div><dt>{details.renewalPrice}</dt><dd>{money(plan.amountMinor)} {details.currentPrice}</dd><p>{details.priceNotice}</p></div>
      </dl>
    </section></>}
    <fieldset className="subscription-consents" disabled={busy}><legend>{copy.confirmations}</legend>
      {consentFields.map(({ checked, setChecked }, index) => <label key={index}><span className="confirmation-checkbox"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} /><Image src={`/portal/subscription-confirmation/${checked ? "checkbox-checked" : "checkbox"}.svg`} width={20} height={20} alt="" /></span><span>{consentCopy[index]}</span></label>)}
    </fieldset>
    {isUpgrade && <p className="upgrade-renewal-note">{upgrade.renewalNote.replace("{category}", sourceCategory).replace("{date}", renewalDate).replace("{price}", money(plan.amountMinor)).replace("{months}", String(plan.termMonths))}</p>}
    {error ? <p className="portal-form-error" role="alert">{error}</p> : null}
    <footer className="confirmation-actions"><button className="portal-button portal-button-primary" type="button" disabled={!renewal || !terms || !refund || busy} onClick={() => void submit()}>{busy ? copy.processing : copy.continue}<span aria-hidden="true">→</span></button></footer>
  </dialog>;
}

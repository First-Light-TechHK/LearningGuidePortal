"use client";

import { useEffect, useRef, useState } from "react";

import Link from "next/link";
import { CourseThumbnail } from "@/components/portal/CourseThumbnail";
import { X } from "lucide-react";
import { getMessages } from "@/lib/i18n/messages";
import { keepFocusInDialog } from "@/lib/dialogFocus";

type Subscription = { id: string; state: "active" | "cancel_at_period_end" | "grace" | "expired" | "trial_canceled"; source: "trial" | "purchase"; validFrom: string; validTo: string; stripeSubscriptionId?: string | null; stripeCustomerId?: string | null; scope?: "course" | "category" | "everything"; plan?: { id?: string; name: string; amountMinor?: number; currency?: string; termMonths?: number; scope?: "course" | "category" | "everything" } | null };
type Order = { id: string; stripeSubscriptionId?: string | null; status: "paid" | "pending" | "failed" | "canceled" | "refunded"; amountMinor: number; currency: string; paymentMode: "demo" | "stripe"; kind?: "purchase" | "trial_activation" | "upgrade"; createdAt: string; servicePeriodStart?: string | null; servicePeriodEnd?: string | null; stripeInvoiceId?: string | null; plan?: { id?: string; name: string } | null };
type Copy = {
  title: string; active: string; trial: string; grace: string; cancelAtPeriodEnd: string; canceled: string; expired: string; cancel: string; resume: string; manage: string; validUntil: string; records: string; date: string; amount: string; receipt: string; noReceipt: string; paid: string; pending: string; failed: string; canceledPayment: string; refunded: string; trialActivation: string;
  cancelTitle: string; cancelDescription: string; cancelReason: string; reasonLowUsage: string; reasonTooExpensive: string; reasonContent: string; reasonWebsite: string; reasonOther: string; reasonOtherPlaceholder: string; characters: string; confirmCancel: string; close: string; updatePaymentMethod: string; payNow: string; plan: string; validPeriod: string; upgrade: string;
};

type Reason = "low_usage" | "too_expensive" | "content" | "website" | "other";

export function SubscriptionManager({ initialSubscriptions, initialOrders, locale, copy }: { initialSubscriptions: Subscription[]; initialOrders: Order[]; locale: "en-GB" | "zh-CN"; copy: Copy }) {
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [cancelTarget, setCancelTarget] = useState<Subscription | null>(null);
  const [reason, setReason] = useState<Reason | undefined>();
  const [reasonText, setReasonText] = useState("");
  const cancelDialog = useRef<HTMLDialogElement>(null);
  const design = getMessages(locale).cancelDesign;
  const view = getMessages(locale).subscriptionDesign;
  const paidOrders = initialOrders.filter((order) => order.status === "paid" && order.kind !== "trial_activation").sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  useEffect(() => {
    const element = cancelDialog.current;
    if (!cancelTarget || !element) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => { element.close(); document.body.style.overflow = overflow; previousFocus?.focus(); };
  }, [cancelTarget]);

  function subscriptionFor(order: Order) {
    return order.stripeSubscriptionId
      ? subscriptions.find((item) => item.stripeSubscriptionId === order.stripeSubscriptionId)
      : subscriptions.find((item) => item.source === "purchase" && item.plan?.id && item.plan.id === order.plan?.id);
  }

  function latestOrderFor(subscription: Subscription) {
    return paidOrders.find((order) => subscriptionFor(order)?.id === subscription.id);
  }

  async function updateSubscription(subscription: Subscription, action: "cancel" | "resume", reasonCode?: Reason, reasonText?: string) {
    setBusyId(subscription.id); setError("");
    try {
      const response = await fetch("/api/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriptionId: subscription.id, action, reasonCode, reasonText }) });
      const data = await response.json() as { subscription?: Subscription; error?: string };
      if (!response.ok || !data.subscription) throw new Error(data.error || "Subscription update failed.");
      setSubscriptions((current) => current.map((item) => item.id === data.subscription?.id ? { ...item, ...data.subscription } : item));
      if (action === "resume") setCancelTarget(null);
      return true;
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Subscription update failed."); return false; }
    finally { setBusyId(""); }
  }

  async function confirmCancel(skipReason = false) {
    if (!cancelTarget) return;
    setBusyId(cancelTarget.id); setError("");
    const updated = await updateSubscription(cancelTarget, "cancel", skipReason ? undefined : reason, skipReason || reason !== "other" ? undefined : reasonText);
    if (updated) { setCancelTarget(null); setReasonText(""); }
    setBusyId("");
  }

  async function manage(subscriptionId?: string, action: "manage" | "pay" = "manage") {
    setError("");
    try {
      const response = await fetch("/api/subscription/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale, subscriptionId, action }) });
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || "Billing could not be opened.");
      window.location.assign(data.url);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Billing could not be opened."); }
  }

  function stateLabel(subscription: Subscription) {
    if (subscription.state === "active") return subscription.source === "trial" ? copy.trial : copy.active;
    if (subscription.state === "cancel_at_period_end") return copy.cancelAtPeriodEnd;
    if (subscription.state === "trial_canceled") return copy.canceled;
    if (subscription.state === "grace") return copy.grace;
    return copy.expired;
  }

  function orderStatusLabel(order: Order) {
    if (order.kind === "trial_activation") return copy.trialActivation;
    if (order.status === "paid") return copy.paid;
    if (order.status === "pending") return copy.pending;
    if (order.status === "failed") return copy.failed;
    if (order.status === "canceled") return copy.canceledPayment;
    return copy.refunded;
  }

  const reasonOptions: Array<[Reason, string]> = [["low_usage", copy.reasonLowUsage], ["too_expensive", copy.reasonTooExpensive], ["content", copy.reasonContent], ["website", copy.reasonWebsite], ["other", copy.reasonOther]];
  return <section className="subscription-section">
    <div className="subscription-heading"><div><h2>{view.records}</h2><p>{view.recordsIntro}</p></div>{subscriptions.some((subscription) => subscription.source === "purchase" && subscription.stripeCustomerId) ? <button className="portal-button portal-button-secondary" onClick={() => void manage()} type="button">{copy.manage}</button> : null}</div>
    {paidOrders.length ? <div className="subscription-records">
      <div className="subscription-record-head" aria-hidden="true"><span>{copy.plan}</span><span>{copy.amount}</span><span>{copy.validPeriod}</span><span>{copy.receipt}</span></div>
      <div className="subscription-record-list">{paidOrders.map((order) => {
        const subscription = subscriptionFor(order);
        const latest = subscription && latestOrderFor(subscription)?.id === order.id;
        const canCancel = latest && subscription.state === "active";
        const receiptAvailable = Boolean(order.stripeInvoiceId) || order.paymentMode === "demo";
        return <article className="subscription-record" key={order.id}>
          <div className="subscription-record-plan"><CourseThumbnail slug={order.plan?.name || ""} title={order.plan?.name || ""} /><div><h3>{order.plan?.name || copy.plan}</h3>{latest ? <span className={`subscription-state subscription-state-${subscription.state}`}>{stateLabel(subscription)}</span> : null}<div className="table-actions">
            {canCancel ? <button type="button" disabled={busyId === subscription.id} onClick={() => {setReason(undefined);setReasonText("");setError("");setCancelTarget(subscription);}}>{copy.cancel}</button> : null}
            {latest && subscription.state === "grace" ? <><button type="button" onClick={() => void manage(subscription.id)}>{copy.updatePaymentMethod}</button><button type="button" onClick={() => void manage(subscription.id,"pay")}>{copy.payNow}</button></> : null}
            {latest && subscription.state === "active" && subscription.scope === "category" ? <Link href={`/${locale}/pricing?upgradeFrom=${encodeURIComponent(subscription.id)}`}>{copy.upgrade}</Link> : null}
          </div></div></div>
          <div className="subscription-record-amount"><span className="subscription-mobile-label">{copy.amount}</span>{new Intl.NumberFormat(locale,{style:"currency",currency:order.currency,currencyDisplay:"narrowSymbol"}).format(order.amountMinor/100)} {order.currency.toUpperCase()}</div>
          <div className="subscription-record-period"><span className="subscription-mobile-label">{copy.validPeriod}</span>{order.servicePeriodStart && order.servicePeriodEnd ? `${new Date(order.servicePeriodStart).toLocaleDateString(locale)} – ${new Date(order.servicePeriodEnd).toLocaleDateString(locale)}` : view.periodUnavailable}</div>
          <div>{receiptAvailable ? <a className="subscription-record-receipt" href={`/api/my-learning/orders/${encodeURIComponent(order.id)}/receipt`} target="_blank" rel="noreferrer">{copy.receipt}</a> : <span>{copy.noReceipt}</span>}</div>
        </article>;
      })}</div><p className="subscription-record-note">{view.paymentNote}</p>
    </div> : <div className="subscription-record-empty"><p>{view.noPayments}</p><Link className="portal-button portal-button-primary" href={`/${locale}/pricing`}>{view.viewPlans}</Link></div>}
    {subscriptions.filter((item) => item.source === "trial").map((subscription) => <div className="subscription-trial-row" key={subscription.id}><strong>{subscription.plan?.name || copy.trial}</strong><span>{stateLabel(subscription)}</span><span>{copy.validUntil}: {new Date(subscription.validTo).toLocaleDateString(locale)}</span>{subscription.state === "active" ? <button className="portal-button portal-button-secondary" type="button" onClick={() => {setReason(undefined);setReasonText("");setCancelTarget(subscription);}}>{copy.cancel}</button> : subscription.state === "trial_canceled" && new Date(subscription.validTo) > new Date() ? <button className="portal-button portal-button-secondary" onClick={() => void updateSubscription(subscription,"resume")} type="button">{copy.resume}</button> : null}</div>)}
    <details className="payment-records"><summary>{view.allAttempts}</summary>{initialOrders.length ? <div className="subscription-table-wrap"><table className="subscription-table"><thead><tr><th>{copy.plan}</th><th>{copy.amount}</th><th>{copy.date}</th><th>{copy.receipt}</th></tr></thead><tbody>{initialOrders.map((order) => { const receiptAvailable = order.status === "paid" && order.kind !== "trial_activation" && (order.paymentMode === "demo" || Boolean(order.stripeInvoiceId)); return <tr key={order.id}><td><strong>{order.plan?.name || copy.trialActivation}</strong><span className="subscription-state">{orderStatusLabel(order)}</span></td><td>{(order.amountMinor / 100).toFixed(2)} {order.currency.toUpperCase()}</td><td>{new Date(order.createdAt).toLocaleDateString(locale)}</td><td>{receiptAvailable ? <a className="table-link" href={`/api/my-learning/orders/${encodeURIComponent(order.id)}/receipt`} target="_blank" rel="noreferrer">{copy.receipt}</a> : <span className="muted-cell">{copy.noReceipt}</span>}</td></tr>; })}</tbody></table></div> : <p className="portal-empty">{copy.noReceipt}</p>}</details>
    {error ? <p className="portal-form-error" role="alert">{error}</p> : null}
    {cancelTarget ? <dialog ref={cancelDialog} className="subscription-modal cancellation-dialog" aria-labelledby="cancel-title" onKeyDown={keepFocusInDialog} onCancel={(event) => { event.preventDefault(); if (busyId !== cancelTarget.id) setCancelTarget(null); }}><button className="subscription-modal-close" type="button" onClick={() => setCancelTarget(null)} disabled={busyId === cancelTarget.id} aria-label={copy.close}><X size={24} aria-hidden="true" /></button><h2 id="cancel-title">{copy.cancelTitle}</h2><p className="cancel-plan-name">{cancelTarget.plan?.name}</p><p>{cancelTarget.source === "trial" ? copy.cancelDescription : design.accessUntil.replace("{date}", new Date(cancelTarget.validTo).toLocaleDateString(locale))}</p><fieldset><legend>{copy.cancelReason}</legend><p className="cancel-reason-help">{design.optionalReason}</p>{reasonOptions.map(([value, label]) => <label key={value}><input type="radio" name="cancel-reason" checked={reason === value} onChange={() => setReason(value)} />{label}</label>)}</fieldset>{reason === "other" ? <label>{copy.reasonOther}<textarea maxLength={500} value={reasonText} onChange={(event) => setReasonText(event.target.value)} placeholder={copy.reasonOtherPlaceholder} /><span className="character-count">{reasonText.length}/500 {copy.characters}</span></label> : null}{error ? <p className="portal-form-error" role="alert">{error}</p> : null}<div className="subscription-modal-actions"><button className="portal-text-button cancel-skip" type="button" disabled={busyId === cancelTarget.id} onClick={() => void confirmCancel(true)}>{design.skip}</button><button className="portal-button portal-button-secondary" type="button" disabled={busyId === cancelTarget.id} onClick={() => setCancelTarget(null)}>{copy.close}</button><button className="portal-button portal-button-primary" type="button" disabled={busyId === cancelTarget.id} onClick={() => void confirmCancel()}>{copy.confirmCancel}</button></div></dialog> : null}
  </section>;
}

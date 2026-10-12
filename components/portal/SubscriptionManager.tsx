"use client";

import { useEffect, useRef, useState } from "react";

import Link from "next/link";
import Image from "next/image";
import { X } from "lucide-react";
import { getMessages } from "@/lib/i18n/messages";
import { keepFocusInDialog } from "@/lib/dialogFocus";

import type { SubscriptionRecordSubscription as Subscription, SubscriptionRecordOrder as Order } from "@/contracts/subscription-records";
import { groupSubscriptionRecords } from "@/services/subscriptionRecords";
import { localSubscriptionProductImage } from "@/lib/subscriptionProductImages";
import styles from "./subscription-records.module.css";

type Copy = {
  title: string; active: string; trial: string; grace: string; cancelAtPeriodEnd: string; canceled: string; expired: string; cancel: string; resume: string; manage: string; validUntil: string; records: string; date: string; amount: string; receipt: string; noReceipt: string; paid: string; pending: string; failed: string; canceledPayment: string; refunded: string; trialActivation: string;
  cancelTitle: string; cancelDescription: string; cancelReason: string; reasonLowUsage: string; reasonTooExpensive: string; reasonContent: string; reasonWebsite: string; reasonOther: string; reasonOtherPlaceholder: string; characters: string; confirmCancel: string; close: string; updatePaymentMethod: string; payNow: string; plan: string; validPeriod: string; upgrade: string;
};

type Reason = "low_usage" | "too_expensive" | "content" | "website" | "other";

export function SubscriptionManager({ initialSubscriptions, initialOrders, locale, copy }: { initialSubscriptions: Subscription[]; initialOrders: Order[]; locale: "en-GB" | "zh-CN"; copy: Copy }) {
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);
  useEffect(() => { setSubscriptions(initialSubscriptions); }, [initialSubscriptions]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [cancelTarget, setCancelTarget] = useState<Subscription | null>(null);
  const [reason, setReason] = useState<Reason | undefined>();
  const [reasonText, setReasonText] = useState("");
  const cancelDialog = useRef<HTMLDialogElement>(null);
  const design = getMessages(locale).cancelDesign;
  const view = getMessages(locale).subscriptionDesign;
  const records = groupSubscriptionRecords(subscriptions, initialOrders);
  useEffect(() => {
    const element = cancelDialog.current;
    if (!cancelTarget || !element) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => { element.close(); document.body.style.overflow = overflow; previousFocus?.focus(); };
  }, [cancelTarget]);

  async function updateSubscription(subscription: Subscription, action: "cancel" | "resume", reasonCode?: Reason, reasonText?: string) {
    setBusyId(subscription.id); setError("");
    try {
      const response = await fetch("/api/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriptionId: subscription.id, action, reasonCode, reasonText }) });
      const data = await response.json() as { subscription?: Subscription; error?: string };
      if (!response.ok || !data.subscription) throw new Error(data.error || view.updateFailed);
      setSubscriptions((current) => current.map((item) => item.id === data.subscription?.id ? { ...item, ...data.subscription } : item));
      if (action === "resume") setCancelTarget(null);
      return true;
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : view.updateFailed); return false; }
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
      if (!response.ok || !data.url) throw new Error(data.error || view.billingFailed);
      window.location.assign(data.url);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : view.billingFailed); }
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
  return <section className={styles.records}>
    {records.length ? <div className={styles.list}>{records.map(record => {
      const subscription = record.subscription;
      const order = record.orders.find(item => item.status === "paid") || record.orders[0];
      const name = order?.presentation?.name || subscription?.plan?.name || copy.plan;
      const image = order?.presentation?.image || localSubscriptionProductImage(subscription?.plan);
      const state = subscription?.state || "unavailable";
      const until = subscription?.state === "grace" ? subscription.graceEndsAt || subscription.validTo : subscription?.validTo || order?.servicePeriodEnd;
      const timeLabel = state === "grace" ? view.gracePeriod : state === "cancel_at_period_end" ? view.accessUntil : state === "expired" || state === "trial_canceled" ? view.expiredOn : state === "unavailable" ? copy.validPeriod : copy.validUntil;
      const status = state === "active" ? subscription?.source === "trial" ? copy.trial : view.active : state === "cancel_at_period_end" ? view.renewalCanceled : state === "grace" ? view.paymentFailed : state === "trial_canceled" ? copy.canceled : state === "expired" ? view.expired : view.statusUnavailable;
      return <article className={styles.card} key={record.id} data-subscription-id={record.id}>
        <div className={styles.summary}>
          <div className={styles.product}><h2>{name}</h2>{image ? <Image className={styles.cover} src={image} alt={name} width={290} height={130} unoptimized/> : <div className={styles.missingCover}>{view.imageUnavailable}</div>}</div>
          <div className={styles.state} data-state={state}><strong>{status}</strong><div className={styles.actions}>
            {subscription && state === "active" ? <button type="button" disabled={busyId === subscription.id} onClick={() => {setReason(undefined);setReasonText("");setError("");setCancelTarget(subscription);}}>{subscription.source === "trial" ? copy.cancel : view.cancelRenewal}</button> : null}
            {subscription && (state === "cancel_at_period_end" || state === "trial_canceled") && new Date(subscription.validTo) > new Date() ? <button type="button" disabled={busyId === subscription.id} onClick={() => void updateSubscription(subscription,"resume")}>{copy.resume}</button> : null}
            {subscription && state === "grace" ? <><button type="button" onClick={() => void manage(subscription.id,"pay")}>{copy.payNow} →</button><button type="button" onClick={() => void manage(subscription.id)}>{copy.updatePaymentMethod}</button></> : null}
            {subscription && state === "active" && subscription.scope === "category" ? <Link href={`/${locale}/pricing?upgradeFrom=${encodeURIComponent(subscription.id)}`}>{copy.upgrade}</Link> : null}
            {subscription?.stripeCustomerId && state === "active" ? <button type="button" onClick={() => void manage(subscription.id)}>{copy.manage}</button> : null}
            {state === "expired" || state === "trial_canceled" ? <Link href={`/${locale}/pricing${subscription?.plan?.id ? `?planId=${encodeURIComponent(subscription.plan.id)}` : ""}`}>{view.subscribeAgain} →</Link> : null}
          </div></div>
          <div className={styles.time}><strong>{timeLabel}</strong><span>{until ? new Date(until).toLocaleDateString(locale,{day:"numeric",month:"short",year:"numeric"}) : view.periodUnavailable}</span></div>
          <button className={styles.historyToggle} type="button" aria-expanded={Boolean(expanded[record.id])} aria-controls={`payments-${record.id}`} onClick={() => setExpanded(current => ({...current,[record.id]:!current[record.id]}))}>{view.paymentHistory}<Image src={`/portal/subscriptions/design/chevron-${expanded[record.id] ? "up" : "down"}.svg`} width={16} height={16} alt=""/></button>
        </div>
        {expanded[record.id] ? <div className={styles.history} id={`payments-${record.id}`}>
          {record.orders.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>{view.paymentDate}</th><th>{view.status}</th><th>{copy.amount}</th><th>{copy.validPeriod}</th><th>{copy.receipt}</th></tr></thead><tbody>{record.orders.map(payment => {
            const receipt = payment.status === "paid" && payment.kind !== "trial_activation" && (payment.paymentMode === "demo" || Boolean(payment.stripeInvoiceId));
            return <tr key={payment.id}><td>{new Date(payment.createdAt).toLocaleDateString(locale,{day:"numeric",month:"short",year:"numeric"})}</td><td>{orderStatusLabel(payment)}</td><td>{new Intl.NumberFormat(locale,{style:"currency",currency:payment.currency,currencyDisplay:"narrowSymbol"}).format(payment.amountMinor/100)} {payment.currency.toUpperCase()}</td><td>{payment.servicePeriodStart && payment.servicePeriodEnd ? `${new Date(payment.servicePeriodStart).toLocaleDateString(locale,{day:"numeric",month:"short",year:"numeric"})} \u2013 ${new Date(payment.servicePeriodEnd).toLocaleDateString(locale,{day:"numeric",month:"short",year:"numeric"})}` : view.periodUnavailable}</td><td>{receipt ? <a href={`/api/my-learning/orders/${encodeURIComponent(payment.id)}/receipt`} target="_blank" rel="noreferrer">{view.viewReceipt}</a> : <span>{copy.noReceipt}</span>}</td></tr>;
          })}</tbody></table></div> : <p>{view.noHistory}</p>}
        </div> : null}
      </article>;
    })}</div> : <div className={styles.empty}><p>{view.noSubscriptions}</p><Link className="portal-button portal-button-primary" href={`/${locale}/pricing`}>{view.viewPlans}</Link></div>}
    {error ? <p className="portal-form-error" role="alert">{error}</p> : null}
    {cancelTarget ? <dialog ref={cancelDialog} className="subscription-modal cancellation-dialog" aria-labelledby="cancel-title" onKeyDown={keepFocusInDialog} onCancel={(event) => { event.preventDefault(); if (busyId !== cancelTarget.id) setCancelTarget(null); }}><button className="subscription-modal-close" type="button" onClick={() => setCancelTarget(null)} disabled={busyId === cancelTarget.id} aria-label={copy.close}><X size={24} aria-hidden="true" /></button><h2 id="cancel-title">{copy.cancelTitle}</h2><p className="cancel-access-note">{cancelTarget.source === "trial" ? copy.cancelDescription : design.accessUntil.replace("{date}", new Date(cancelTarget.validTo).toLocaleDateString(locale))}</p><div className="cancel-plan-name"><strong>{cancelTarget.scope === "everything" ? "Everything" : "Category"}</strong>{cancelTarget.scope !== "everything" ? <span>{cancelTarget.plan?.name}</span> : null}</div><fieldset><legend>{copy.cancelReason}<span className="cancel-reason-help">{design.optionalReason}</span></legend>{reasonOptions.map(([value, label]) => <label key={value}><input type="radio" name="cancel-reason" checked={reason === value} onChange={() => setReason(value)} />{label}</label>)}</fieldset><label className="cancel-other-input"><textarea maxLength={500} value={reasonText} onChange={(event) => setReasonText(event.target.value)} placeholder={copy.reasonOtherPlaceholder} /><span className="character-count">{reasonText.length}/500 {copy.characters}</span></label>{error ? <p className="portal-form-error" role="alert">{error}</p> : null}<div className="subscription-modal-actions"><button className="portal-text-button cancel-skip" type="button" disabled={busyId === cancelTarget.id} onClick={() => void confirmCancel(true)}>{design.skip}</button><button className="portal-button portal-button-secondary" type="button" disabled={busyId === cancelTarget.id} onClick={() => setCancelTarget(null)}>{copy.close}</button><button className="portal-button portal-button-primary" type="button" disabled={busyId === cancelTarget.id} onClick={() => void confirmCancel()}>{copy.confirmCancel}</button></div></dialog> : null}
  </section>;
}

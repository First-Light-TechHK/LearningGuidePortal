"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { getMessages } from "@/lib/i18n/messages";
import { keepFocusInDialog } from "@/lib/dialogFocus";
import type { SubscriptionRecordSubscription as Subscription, SubscriptionRecordOrder as Order } from "@/contracts/subscription-records";
import type { SubscriptionCancelReason } from "@/contracts/subscription-management";
import { canViewSubscriptionReceipt } from "@/contracts/subscription-records";
import { formatPlanPrice } from "@/lib/planPricing";
import { subscriptionListRecords } from "@/services/subscriptionRecords";
import { localSubscriptionProductImage } from "@/lib/subscriptionProductImages";
import { subscriptionCategoryLabel } from "@/lib/subscriptionCategoryLabel";
import styles from "./subscription-records.module.css";

type Copy = {
  title: string; active: string; trial: string; grace: string; cancelAtPeriodEnd: string; canceled: string; expired: string; cancel: string; resume: string; manage: string; validUntil: string; records: string; date: string; amount: string; receipt: string; noReceipt: string; paid: string; pending: string; failed: string; canceledPayment: string; refunded: string; trialActivation: string;
  cancelTitle: string; cancelDescription: string; cancelReason: string; reasonLowUsage: string; reasonTooExpensive: string; reasonContent: string; reasonWebsite: string; reasonOther: string; reasonOtherPlaceholder: string; characters: string; confirmCancel: string; close: string; updatePaymentMethod: string; payNow: string; plan: string; validPeriod: string; upgrade: string;
};

export function SubscriptionManager({ initialSubscriptions, initialOrders, locale, copy }: { initialSubscriptions: Subscription[]; initialOrders: Order[]; locale: "en-GB" | "zh-CN"; copy: Copy }) {
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);
  useEffect(() => { setSubscriptions(initialSubscriptions); }, [initialSubscriptions]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pastOpen, setPastOpen] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const actionInFlight = useRef(false);
  const [cancelTarget, setCancelTarget] = useState<Subscription | null>(null);
  const [reason, setReason] = useState<SubscriptionCancelReason>();
  const [reasonText, setReasonText] = useState("");
  const cancelDialog = useRef<HTMLDialogElement>(null);
  const messages = getMessages(locale), design = messages.cancelDesign, view = messages.subscriptionDesign;
  const records = subscriptionListRecords(subscriptions, initialOrders);
  const current = records.filter(record => !record.past), past = records.filter(record => record.past);
  const livePaid = current.flatMap(record => record.subscription?.source === "purchase" ? [record.subscription] : []);
  const allowCategoryUpgrade = !livePaid.some(item => (item.scope || item.plan?.scope) === "everything") && new Set(livePaid.filter(item => (item.scope || item.plan?.scope) === "category").map(item => item.scopeId || item.plan?.scopeId || item.plan?.category).filter(Boolean)).size === 1;
  const date = (value: string) => new Date(value).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const nameOf = (subscription: Subscription | null, order?: Order) => {
    const scope = subscription?.scope || subscription?.plan?.scope;
    const name = subscription?.scopeId || subscription?.plan?.scopeId || subscription?.plan?.category || order?.presentation?.name || subscription?.plan?.name || copy.plan;
    return scope === "everything" ? messages.pricingDesign.everything : scope === "category" ? `${messages.pricingDesign.category} – ${name}` : order?.presentation?.name || subscription?.plan?.name || copy.plan;
  };
  const requireSignIn = (response: Response) => {
    if (response.status !== 401) return false;
    window.location.assign(`/${locale}/portal/sign-in?returnTo=${encodeURIComponent(`/${locale}/account/my-learning/subscription`)}`);
    return true;
  };
  useEffect(() => {
    const element = cancelDialog.current;
    if (!cancelTarget || !element) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    element.showModal(); document.body.style.overflow = "hidden";
    return () => { element.close(); document.body.style.overflow = overflow; if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [cancelTarget]);

  async function confirmCancel() {
    if (!cancelTarget || actionInFlight.current) return;
    actionInFlight.current = true; setBusyId(cancelTarget.id); setError("");
    try {
      const response = await fetch("/api/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriptionId: cancelTarget.id, action: "cancel", reasonCode: reason, reasonText: reason === "other" ? reasonText : undefined }) });
      if (requireSignIn(response)) return;
      const data = await response.json() as { subscription?: Subscription; error?: string; code?: keyof typeof messages.subscriptionErrors };
      if (!response.ok || !data.subscription) throw new Error(data.code && messages.subscriptionErrors[data.code] || data.error || view.updateFailed);
      if (data.subscription.id !== cancelTarget.id) { window.location.reload(); return; }
      setSubscriptions(items => items.map(item => item.id === data.subscription!.id ? { ...item, ...data.subscription } : item));
      setCancelTarget(null); setReason(undefined); setReasonText("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : view.updateFailed); }
    finally { actionInFlight.current = false; setBusyId(""); }
  }

  async function pay(subscriptionId: string) {
    if (actionInFlight.current) return;
    actionInFlight.current = true; setBusyId(subscriptionId); setError("");
    try {
      const response = await fetch("/api/subscription/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale, subscriptionId, action: "pay" }) });
      if (requireSignIn(response)) return;
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || view.billingFailed);
      window.location.assign(data.url);
    } catch (failure) { setError(failure instanceof Error ? failure.message : view.billingFailed); }
    finally { actionInFlight.current = false; setBusyId(""); }
  }

  async function resume(subscription: Subscription) {
    if (actionInFlight.current) return;
    actionInFlight.current = true; setBusyId(subscription.id); setError("");
    try {
      const response = await fetch("/api/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriptionId: subscription.id, action: "resume" }) });
      if (requireSignIn(response)) return;
      const data = await response.json() as { subscription?: Subscription; error?: string; code?: keyof typeof messages.subscriptionErrors };
      if (!response.ok || !data.subscription) throw new Error(data.code && messages.subscriptionErrors[data.code] || data.error || view.updateFailed);
      setSubscriptions(items => items.map(item => item.id === data.subscription!.id ? { ...item, ...data.subscription } : item));
    } catch (failure) { setError(failure instanceof Error ? failure.message : view.updateFailed); }
    finally { actionInFlight.current = false; setBusyId(""); }
  }

  const paymentStatus = (order: Order) => order.kind === "trial_activation" && order.status === "paid" ? copy.trialActivation : order.status === "paid" ? copy.paid : order.status === "pending" ? copy.pending : order.status === "failed" ? view.failed : order.status === "canceled" ? copy.canceledPayment : copy.refunded;
  const reasons: Array<[SubscriptionCancelReason, string]> = [["low_usage", design.lowUsage], ["too_expensive", design.tooExpensive], ["content", design.content], ["website", design.website], ["other", copy.reasonOther]];

  const card = (record: typeof records[number]) => {
    const subscription = record.subscription, state = record.displayState;
    const order = record.orders.find(item => item.status === "paid") || record.orders[0];
    const name = nameOf(subscription, order);
    const fallbackImage = localSubscriptionProductImage(subscription?.plan);
    const image = order?.presentation?.image && order.presentation.image !== fallbackImage && !["/portal/subscriptions/everything.png", "/portal/subscriptions/science.png", "/portal/subscriptions/chinese_human.png", "/portal/subscriptions/european_human.png"].includes(order.presentation.image) ? order.presentation.image : null;
    const coverLabel = (subscription?.scope === "everything" || subscription?.plan?.scope === "everything" ? "Everything" : subscription?.scopeId || subscription?.plan?.scopeId || subscription?.plan?.category || order?.presentation?.name || subscription?.plan?.name || copy.plan).toUpperCase();
    const colour = /CHINESE/.test(coverLabel) ? "chinese" : /EUROPEAN/.test(coverLabel) ? "european" : /SCIENCE/.test(coverLabel) ? "science" : /EVERYTHING/.test(coverLabel) ? "everything" : "other";
    const until = state === "grace" ? subscription?.graceEndsAt || subscription?.validTo : subscription?.validTo || order?.servicePeriodEnd;
    const status = state === "active" ? subscription?.source === "trial" ? copy.trial : view.active : state === "cancel_at_period_end" ? view.renewalCanceled : state === "grace" ? view.paymentFailed : state === "trial_canceled" ? copy.canceled : state === "expired" ? view.expired : view.statusUnavailable;
    const pendingUpgrade = record.orders.find(item => item.kind === "upgrade" && item.status === "pending" && item.upgradeProration && item.quoteId);
    return <article className={styles.card} key={record.id} data-subscription-id={record.id} data-past={record.past}>
      <div className={styles.summary}>
        <div className={styles.product}><h2>{name}</h2>{image ? <Image className={styles.cover} src={image} alt={name} width={120} height={120} unoptimized/> : <div className={styles.coverArtwork} data-colour={colour} aria-hidden="true"><span>{coverLabel}</span><small>Learning Guide</small></div>}</div>
        <div className={styles.state} data-state={state}><strong aria-live="polite">{status}</strong><div className={styles.actions}>
          {subscription && state === "active" ? <button type="button" disabled={Boolean(busyId)} onClick={() => { setReason(undefined); setReasonText(""); setError(""); setCancelTarget(subscription); }}>{subscription.source === "trial" ? copy.cancel : view.cancelRenewal}</button> : null}
          {subscription && state === "grace" ? <button type="button" disabled={Boolean(busyId)} onClick={() => void pay(subscription.id)}>{copy.payNow}</button> : null}
          {subscription && state === "cancel_at_period_end" ? <button type="button" disabled={Boolean(busyId)} onClick={() => void resume(subscription)}>{view.turnOnRenewal}</button> : null}
          {pendingUpgrade ? <Link href={`/${locale}/portal/subscription/confirmation?quoteId=${encodeURIComponent(pendingUpgrade.quoteId!)}`}>{copy.payNow}</Link> : subscription && allowCategoryUpgrade && state === "active" && subscription.scope === "category" && subscription.device !== "mobile" && subscription.stripeSubscriptionId ? <Link href={`/${locale}/subscription?upgradeFrom=${encodeURIComponent(subscription.id)}`}>{copy.upgrade}</Link> : null}
        </div></div>
        <div className={styles.time} data-state={state}><strong>{state === "grace" ? view.gracePeriod : record.past ? state === "unavailable" ? copy.validPeriod : view.expiredOn : copy.validUntil}</strong><span>{until ? date(until) : view.periodUnavailable}</span></div>
        <button className={styles.historyToggle} type="button" aria-expanded={Boolean(expanded[record.id])} aria-controls={`payments-${record.id}`} onClick={() => setExpanded(items => ({ ...items, [record.id]: !items[record.id] }))}>{view.paymentHistory}<Image src={`/portal/subscriptions/design/chevron-${expanded[record.id] ? "up" : "down"}.svg`} width={16} height={16} alt=""/></button>
      </div>
      {expanded[record.id] ? <div className={styles.history} id={`payments-${record.id}`}>
        {record.orders.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>{view.paymentDate}</th><th>{copy.amount}</th><th>{view.status}</th><th>{copy.validPeriod}</th><th>{copy.receipt}</th></tr></thead><tbody>{record.orders.map(payment => {
          const note = payment.kind === "upgrade" ? payment.upgradeProration ? view.proratedUpgrade : view.upgradeType : payment.plan?.id !== subscription?.plan?.id ? payment.presentation?.name || payment.plan?.name : null;
          return <tr key={payment.id}><td>{date(payment.createdAt)}</td><td>{formatPlanPrice(locale, payment)}{note && <small>{note}</small>}</td><td data-status={payment.status}>{paymentStatus(payment)}</td><td>{payment.servicePeriodStart && payment.servicePeriodEnd ? `${date(payment.servicePeriodStart)} – ${date(payment.servicePeriodEnd)}` : "—"}</td><td>{canViewSubscriptionReceipt(payment) ? <a href={`/api/my-learning/orders/${encodeURIComponent(payment.id)}/receipt?locale=${locale}`} target="_blank" rel="noreferrer">{view.viewReceipt}</a> : "—"}</td></tr>;
        })}</tbody></table></div> : <p>{view.noHistory}</p>}
      </div> : null}
    </article>;
  };

  return <section className={styles.records}>
    {records.length ? <div className={styles.sections}><section className={styles.section}><h2 className={styles.sectionTitle}>{view.currentSubscriptions}</h2><div className={styles.list}>{current.length ? current.map(card) : <p className={styles.noCurrent}>{view.noCurrent}</p>}</div></section>
      {past.length > 0 && <section className={styles.section}><button className={styles.pastToggle} type="button" aria-expanded={pastOpen} aria-controls="past-subscriptions" onClick={() => setPastOpen(value => !value)}>{view.pastSubscriptions} ({past.length})<Image src={`/portal/subscriptions/design/section-chevron-${pastOpen ? "up" : "down"}.svg`} width={16} height={16} alt=""/></button><div className={styles.list} id="past-subscriptions" hidden={!pastOpen}>{past.map(card)}</div></section>}</div> : <div className={styles.empty}><p>{view.noSubscriptions}</p><Link className="portal-button portal-button-primary" href={`/${locale}/subscription`}>{view.viewPlans}</Link></div>}
    {error && !cancelTarget ? <p className="portal-form-error" role="alert">{error}</p> : null}
    {cancelTarget ? <dialog ref={cancelDialog} className={styles.cancelDialog} aria-labelledby="cancel-title" aria-describedby="cancel-access-note" onKeyDown={keepFocusInDialog} onCancel={event => { event.preventDefault(); if (!actionInFlight.current) setCancelTarget(null); }}>
      <header className={styles.cancelHeader}><h2 id="cancel-title">{cancelTarget.source === "trial" ? copy.cancelTitle : design.title}</h2><button type="button" onClick={() => { if (!actionInFlight.current) setCancelTarget(null); }} disabled={Boolean(busyId)} aria-label={copy.close}><Image src="/portal/subscriptions/design/close.svg" width={24} height={24} alt=""/></button></header>
      <div className={styles.cancelPlan}><strong>{(cancelTarget.scope || cancelTarget.plan?.scope) === "category" ? `${design.category} • ${subscriptionCategoryLabel(cancelTarget.scopeId || cancelTarget.plan?.scopeId || cancelTarget.plan?.category || cancelTarget.plan?.name || copy.plan, locale)}` : nameOf(cancelTarget)}</strong><p id="cancel-access-note">{cancelTarget.source === "trial" ? copy.cancelDescription : design.paidAccessUntil.replace("{date}", date(cancelTarget.validTo))}</p></div>
      <fieldset className={styles.questionnaire}><legend>{design.question}</legend><p>{design.feedback}</p><div className={styles.reasons}>{reasons.map(([value, label]) => <label key={value}><span className={styles.radio}><input type="radio" name="cancel-reason" checked={reason === value} onChange={() => setReason(value)} disabled={Boolean(busyId)}/><Image src="/portal/subscriptions/design/radio.svg" width={20} height={20} alt=""/></span><span>{label}</span></label>)}</div><textarea className={styles.otherReason} rows={1} maxLength={500} value={reasonText} onChange={event => { setReasonText(event.target.value); if (event.target.value) setReason("other"); }} placeholder={design.more} aria-label={design.more} disabled={Boolean(busyId)}/></fieldset>
      {error ? <p className="portal-form-error" role="alert">{error}</p> : null}
      <div className={styles.cancelActions}><button type="button" className={styles.cancelConfirm} disabled={Boolean(busyId)} onClick={() => void confirmCancel()}>{busyId ? messages.learning.processing : cancelTarget.source === "trial" ? copy.confirmCancel : design.confirm}</button><button type="button" className={styles.cancelKeep} disabled={Boolean(busyId)} onClick={() => { if (!actionInFlight.current) setCancelTarget(null); }}>{cancelTarget.source === "trial" ? copy.close : design.keep}</button></div>
    </dialog> : null}
  </section>;
}

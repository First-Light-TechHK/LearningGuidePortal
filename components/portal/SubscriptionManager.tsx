"use client";

import { useMemo, useState } from "react";

type Subscription = { id: string; state: "active" | "cancel_at_period_end" | "grace" | "expired" | "trial_canceled"; source: "trial" | "purchase"; validFrom: string; validTo: string; stripeCustomerId?: string | null; plan?: { name: string; amountMinor?: number; currency?: string; termMonths?: number } | null };
type Order = { id: string; status: "paid" | "pending" | "failed" | "canceled" | "refunded"; amountMinor: number; currency: string; paymentMode: "demo" | "stripe"; kind?: "purchase" | "trial_activation"; createdAt: string; stripeInvoiceId?: string | null; plan?: { name: string } | null };
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
  const [reason, setReason] = useState<Reason>("low_usage");
  const [reasonText, setReasonText] = useState("");

  const latestOrderFor = useMemo(() => (subscription: Subscription) => initialOrders.find((order) => order.status === "paid" && order.kind !== "trial_activation" && order.plan?.name === subscription.plan?.name), [initialOrders]);

  async function confirmCancel() {
    if (!cancelTarget) return;
    setBusyId(cancelTarget.id); setError("");
    try {
      const response = await fetch("/api/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriptionId: cancelTarget.id, action: "cancel", reasonCode: reason, reasonText }) });
      const data = await response.json() as { subscription?: Subscription; error?: string };
      if (!response.ok || !data.subscription) throw new Error(data.error || "Subscription update failed.");
      setSubscriptions((current) => current.map((item) => item.id === data.subscription?.id ? { ...item, ...data.subscription } : item));
      setCancelTarget(null); setReasonText("");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Subscription update failed."); }
    finally { setBusyId(""); }
  }

  async function manage() {
    setError("");
    try {
      const response = await fetch("/api/subscription/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale }) });
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
    <div className="subscription-heading"><h2>{copy.title}</h2>{subscriptions.some((subscription) => subscription.source === "purchase" && subscription.stripeCustomerId) ? <button className="portal-button portal-button-secondary" onClick={() => void manage()} type="button">{copy.manage}</button> : null}</div>
    {subscriptions.length ? <div className="subscription-table-wrap"><table className="subscription-table"><thead><tr><th>{copy.plan}</th><th>{copy.amount}</th><th>{copy.validPeriod}</th><th>{copy.receipt}</th><th aria-label="Actions" /></tr></thead><tbody>{subscriptions.map((subscription) => { const order = latestOrderFor(subscription); const receiptAvailable = Boolean(order?.stripeInvoiceId) || order?.paymentMode === "demo"; return <tr key={subscription.id}><td><strong>{subscription.plan?.name || (subscription.source === "trial" ? copy.trial : copy.active)}</strong><span className={`subscription-state subscription-state-${subscription.state}`}>{stateLabel(subscription)}</span></td><td>{order ? `${(order.amountMinor / 100).toFixed(2)} ${order.currency.toUpperCase()}` : subscription.source === "trial" ? "USD 0.00" : "—"}</td><td>{new Date(subscription.validFrom).toLocaleDateString(locale)} – {new Date(subscription.validTo).toLocaleDateString(locale)}</td><td>{receiptAvailable && order ? <a className="table-link" href={`/api/my-learning/orders/${encodeURIComponent(order.id)}/receipt`} target="_blank" rel="noreferrer">{copy.receipt}</a> : <span className="muted-cell">{copy.noReceipt}</span>}</td><td><div className="table-actions">{subscription.state === "active" && subscription.source === "purchase" ? <button className="portal-button portal-button-secondary" disabled={busyId === subscription.id} onClick={() => setCancelTarget(subscription)} type="button">{copy.cancel}</button> : null}{subscription.state === "grace" ? <><button className="portal-button portal-button-secondary" onClick={() => void manage()} type="button">{copy.updatePaymentMethod}</button><button className="portal-button portal-button-primary" onClick={() => window.location.assign(`/${locale}/pricing`)} type="button">{copy.payNow}</button></> : null}{subscription.source === "purchase" && subscription.state === "active" ? <button className="portal-button portal-button-secondary" onClick={() => window.location.assign(`/${locale}/pricing`)} type="button">{copy.upgrade}</button> : null}</div></td></tr>; })}</tbody></table></div> : <p className="portal-empty">{copy.expired}</p>}
    <div className="payment-records"><h3>{copy.records}</h3>{initialOrders.length ? <div className="subscription-table-wrap"><table className="subscription-table"><thead><tr><th>{copy.plan}</th><th>{copy.amount}</th><th>{copy.date}</th><th>{copy.receipt}</th></tr></thead><tbody>{initialOrders.map((order) => { const receiptAvailable = order.status === "paid" && order.kind !== "trial_activation" && (order.paymentMode === "demo" || Boolean(order.stripeInvoiceId)); return <tr key={order.id}><td><strong>{order.plan?.name || copy.trialActivation}</strong><span className="subscription-state">{orderStatusLabel(order)}</span></td><td>{(order.amountMinor / 100).toFixed(2)} {order.currency.toUpperCase()}</td><td>{new Date(order.createdAt).toLocaleDateString(locale)}</td><td>{receiptAvailable ? <a className="table-link" href={`/api/my-learning/orders/${encodeURIComponent(order.id)}/receipt`} target="_blank" rel="noreferrer">{copy.receipt}</a> : <span className="muted-cell">{copy.noReceipt}</span>}</td></tr>; })}</tbody></table></div> : <p className="portal-empty">{copy.noReceipt}</p>}</div>
    {error ? <p className="portal-form-error" role="alert">{error}</p> : null}
    {cancelTarget ? <div className="subscription-modal-backdrop" role="presentation"><section className="subscription-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-title"><button className="subscription-modal-close" type="button" onClick={() => setCancelTarget(null)} aria-label={copy.close}>×</button><h2 id="cancel-title">{copy.cancelTitle}</h2><p>{copy.cancelDescription}</p><fieldset><legend>{copy.cancelReason}</legend>{reasonOptions.map(([value, label]) => <label key={value}><input type="radio" name="cancel-reason" checked={reason === value} onChange={() => setReason(value)} />{label}</label>)}</fieldset>{reason === "other" ? <label>{copy.reasonOther}<textarea maxLength={500} value={reasonText} onChange={(event) => setReasonText(event.target.value)} placeholder={copy.reasonOtherPlaceholder} /><span className="character-count">{reasonText.length}/500 {copy.characters}</span></label> : null}<div className="subscription-modal-actions"><button className="portal-button portal-button-secondary" type="button" onClick={() => setCancelTarget(null)}>{copy.close}</button><button className="portal-button portal-button-primary" type="button" disabled={busyId === cancelTarget.id} onClick={() => void confirmCancel()}>{copy.confirmCancel}</button></div></section></div> : null}
  </section>;
}

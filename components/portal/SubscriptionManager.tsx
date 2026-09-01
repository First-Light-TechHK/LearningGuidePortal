"use client";

import { useState } from "react";

type Subscription = { id: string; state: "active" | "cancel_at_period_end" | "grace" | "expired" | "trial_canceled"; source: "trial" | "purchase"; validTo: string; stripeCustomerId?: string | null; plan?: { name: string } | null };
type Order = { id: string; status: "paid" | "pending" | "failed" | "canceled" | "refunded"; amountMinor: number; currency: string; paymentMode: "demo" | "stripe"; kind?: "purchase" | "trial_activation"; createdAt: string; stripeInvoiceId?: string | null; plan?: { name: string } | null };

type Copy = {
  title: string;
  active: string;
  trial: string;
  grace: string;
  cancelAtPeriodEnd: string;
  canceled: string;
  expired: string;
  cancel: string;
  resume: string;
  manage: string;
  validUntil: string;
  records: string;
  date: string;
  amount: string;
  receipt: string;
  noReceipt: string;
  paid: string;
  pending: string;
  failed: string;
  canceledPayment: string;
  refunded: string;
  trialActivation: string;
};

export function SubscriptionManager({ initialSubscriptions, initialOrders, locale, copy }: { initialSubscriptions: Subscription[]; initialOrders: Order[]; locale: "en-GB" | "zh-CN"; copy: Copy }) {
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  async function update(subscription: Subscription, action: "cancel" | "resume") {
    setBusyId(subscription.id);
    setError("");
    try {
      const response = await fetch("/api/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriptionId: subscription.id, action }) });
      const data = await response.json() as { subscription?: Subscription; error?: string };
      if (!response.ok || !data.subscription) throw new Error(data.error || "Subscription update failed.");
      setSubscriptions((current) => current.map((item) => item.id === data.subscription?.id ? { ...item, ...data.subscription } : item));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Subscription update failed.");
    } finally {
      setBusyId("");
    }
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

  return <section className="subscription-section"><div className="subscription-heading"><h2>{copy.title}</h2>{subscriptions.some((subscription) => subscription.source === "purchase" && subscription.stripeCustomerId) ? <button className="portal-button portal-button-secondary" onClick={() => void manage()} type="button">{copy.manage}</button> : null}</div>{subscriptions.length ? <div className="subscription-list">{subscriptions.map((subscription) => <article className="subscription-row" key={subscription.id}><div><strong>{subscription.plan?.name || (subscription.source === "trial" ? copy.trial : copy.active)}</strong><span>{stateLabel(subscription)} · {copy.validUntil} {new Date(subscription.validTo).toLocaleDateString(locale)}</span></div>{subscription.state === "active" ? <button className="portal-button portal-button-secondary" disabled={busyId === subscription.id} onClick={() => void update(subscription, "cancel")} type="button">{copy.cancel}</button> : subscription.state === "cancel_at_period_end" || subscription.state === "trial_canceled" ? <button className="portal-button portal-button-secondary" disabled={busyId === subscription.id} onClick={() => void update(subscription, "resume")} type="button">{copy.resume}</button> : null}</article>)}</div> : <p className="portal-empty">{copy.expired}</p>}<div className="payment-records"><h3>{copy.records}</h3>{initialOrders.length ? <div className="subscription-list">{initialOrders.map((order) => { const receiptAvailable = order.status === "paid" && order.kind !== "trial_activation" && (order.paymentMode === "demo" || Boolean(order.stripeInvoiceId)); return <article className="subscription-row payment-record-row" key={order.id}><div><strong>{order.plan?.name || copy.trialActivation}</strong><span>{orderStatusLabel(order)} · {copy.date} {new Date(order.createdAt).toLocaleDateString(locale)} · {copy.amount} {(order.amountMinor / 100).toFixed(2)} {order.currency.toUpperCase()}</span></div>{receiptAvailable ? <a className="portal-button portal-button-secondary" href={`/api/my-learning/orders/${encodeURIComponent(order.id)}/receipt`} target="_blank" rel="noreferrer">{copy.receipt}</a> : <span className="order-state">{copy.noReceipt}</span>}</article>; })}</div> : <p className="portal-empty">{copy.noReceipt}</p>}</div>{error ? <p className="portal-form-error" role="alert">{error}</p> : null}</section>;
}

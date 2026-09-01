"use client";

import { useState } from "react";

type Subscription = { id: string; state: "active" | "cancel_at_period_end" | "grace" | "expired" | "trial_canceled"; source: "trial" | "purchase"; validTo: string; plan?: { name: string } | null };

export function SubscriptionManager({ initialSubscriptions, copy }: { initialSubscriptions: Subscription[]; copy: { title: string; active: string; trial: string; cancelAtPeriodEnd: string; canceled: string; expired: string; cancel: string; resume: string; validUntil: string } }) {
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

  function stateLabel(subscription: Subscription) {
    if (subscription.state === "active") return subscription.source === "trial" ? copy.trial : copy.active;
    if (subscription.state === "cancel_at_period_end") return copy.cancelAtPeriodEnd;
    if (subscription.state === "trial_canceled") return copy.canceled;
    return copy.expired;
  }

  return <section className="subscription-section"><h2>{copy.title}</h2>{subscriptions.length ? <div className="subscription-list">{subscriptions.map((subscription) => <article className="subscription-row" key={subscription.id}><div><strong>{subscription.plan?.name || (subscription.source === "trial" ? copy.trial : copy.active)}</strong><span>{stateLabel(subscription)} · {copy.validUntil} {new Date(subscription.validTo).toLocaleDateString()}</span></div>{subscription.state === "active" ? <button className="portal-button portal-button-secondary" disabled={busyId === subscription.id} onClick={() => void update(subscription, "cancel")} type="button">{copy.cancel}</button> : subscription.state === "cancel_at_period_end" || subscription.state === "trial_canceled" ? <button className="portal-button portal-button-secondary" disabled={busyId === subscription.id} onClick={() => void update(subscription, "resume")} type="button">{copy.resume}</button> : null}</article>)}</div> : <p className="portal-empty">{copy.expired}</p>}{error ? <p className="portal-form-error" role="alert">{error}</p> : null}</section>;
}

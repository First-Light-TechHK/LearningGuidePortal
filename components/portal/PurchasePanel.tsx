"use client";

import { useEffect, useId, useState } from "react";

type Plan = { available?: boolean; id: string; name: string; termMonths: 6 | 12; device: "pc" | "mobile"; amountMinor: number; currency: string; aiPoints?: number };

export function PurchasePanel({ locale, courseId, plans, allowTrial = true, compact = false, copy }: { locale: "en-GB" | "zh-CN"; courseId: string; plans: Plan[]; allowTrial?: boolean; compact?: boolean; copy: { startTrial: string; buy: string; choosePlan: string } }) {
  const groupId = useId();
  const [selectedPlan, setSelectedPlan] = useState(plans[0]?.id || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const planId = new URLSearchParams(window.location.search).get("planId");
    if (planId && plans.some((plan) => plan.id === planId)) setSelectedPlan(planId);
  }, [plans]);

  function signInForPlan() {
    const target = new URL(window.location.href);
    target.searchParams.set("planId", selectedPlan);
    window.location.assign(`/${locale}/portal/sign-in?returnTo=${encodeURIComponent(target.pathname + target.search)}`);
  }

  async function startTrial() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/subscription/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: selectedPlan, kind: "trial" }) });
      const data = await response.json() as { error?: string; quote?: { id: string } };
      if (response.status === 401) { signInForPlan(); return; }
      if (!response.ok) throw new Error(data.error || "Trial activation failed.");
      if (!data.quote) throw new Error("Trial quote was not created.");
      window.location.assign(`/${locale}/portal/subscription/confirmation?quoteId=${encodeURIComponent(data.quote.id)}`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Trial activation failed."); setBusy(false); }
  }

  async function purchase() {
    if (!selectedPlan) return;
    setBusy(true); setError("");
    try {
      const quoteResponse = await fetch("/api/subscription/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: selectedPlan, kind: "purchase" }) });
      const quoteData = await quoteResponse.json() as { quote?: { id: string }; error?: string };
      if (quoteResponse.status === 401) { signInForPlan(); return; }
      if (!quoteResponse.ok || !quoteData.quote) throw new Error(quoteData.error || "Price calculation failed.");
      window.location.assign(`/${locale}/portal/subscription/confirmation?quoteId=${encodeURIComponent(quoteData.quote.id)}`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Checkout failed."); setBusy(false); }
  }

  return (
    <div className="purchase-panel">
      {!compact ? <><h2>{copy.choosePlan}</h2>
      <div className="purchase-plans">
        {plans.map((plan) => <label className={`purchase-plan ${selectedPlan === plan.id ? "selected" : ""}`} key={plan.id}><input type="radio" name={groupId} checked={selectedPlan === plan.id} onChange={() => setSelectedPlan(plan.id)} /><span><strong>{plan.name}</strong><small>${(plan.amountMinor / 100).toFixed(2)} USD</small></span></label>)}
      </div></> : null}
      {error ? <p className="portal-form-error" role="alert">{error}</p> : null}
      <div className="purchase-actions">{allowTrial ? <button className="portal-button portal-button-secondary" disabled={busy || plans.find(plan => plan.id === selectedPlan)?.available === false} onClick={startTrial}>{copy.startTrial}</button> : null}<button className="portal-button portal-button-primary" disabled={busy || !selectedPlan || plans.find(plan => plan.id === selectedPlan)?.available === false} onClick={purchase}>{busy ? "..." : copy.buy}</button></div>
    </div>
  );
}

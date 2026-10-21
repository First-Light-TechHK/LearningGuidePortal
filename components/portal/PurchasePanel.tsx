"use client";

import { formatPlanPrice } from "@/lib/planPricing";

import { useEffect, useId, useRef, useState } from "react";
import { getMessages } from "@/lib/i18n/messages";

type Plan = { alreadySubscribed?: boolean; upgradeUnavailable?: boolean; available?: boolean; id: string; name: string; termMonths: 6 | 12; device: "pc" | "mobile"; amountMinor: number; currency: string; aiPoints?: number };

function isSelectable(plan: Plan) { return !plan.alreadySubscribed && !plan.upgradeUnavailable && plan.available !== false; }

export function PurchasePanel({ locale, courseId, plans, allowTrial = true, compact = false, copy }: { locale: "en-GB" | "zh-CN"; courseId: string; plans: Plan[]; allowTrial?: boolean; compact?: boolean; copy: { startTrial: string; buy: string; choosePlan: string } }) {
  const groupId = useId();
  const [selectedPlan, setSelectedPlan] = useState(plans.find(isSelectable)?.id || "");
  const selected = plans.find(plan => plan.id === selectedPlan);
  const blocked = !selected || !isSelectable(selected);
  const subscribed = plans.length > 0 && plans.every(plan => plan.alreadySubscribed);
  const messages = getMessages(locale);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const initialPlanRead = useRef(false);

  useEffect(() => {
    // The return URL seeds the first selection only. Refreshing server plans
    // must retain a term the user subsequently selected in this panel.
    const planId = initialPlanRead.current ? null : new URLSearchParams(window.location.search).get("planId");
    initialPlanRead.current = true;
    setSelectedPlan(current => plans.find(plan => plan.id === planId && isSelectable(plan))?.id || plans.find(plan => plan.id === current && isSelectable(plan))?.id || plans.find(isSelectable)?.id || "");
  }, [plans]);

  function signInForPlan() {
    const target = new URL(window.location.href);
    target.searchParams.set("planId", selectedPlan);
    window.location.assign(`/${locale}/portal/sign-in?returnTo=${encodeURIComponent(target.pathname + target.search)}`);
  }

  async function startTrial() {
    if (blocked) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/subscription/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: selectedPlan, kind: "trial" }) });
      const data = await response.json() as { error?: string; quote?: { id: string }; code?: string };
      if (response.status === 401) { signInForPlan(); return; }
      if (!response.ok) throw new Error(data.code === "already_subscribed" || data.code === "upgrade_unavailable" ? messages.paymentErrors[data.code] : data.error || "Trial activation failed.");
      if (!data.quote) throw new Error("Trial quote was not created.");
      window.location.assign(`/${locale}/portal/subscription/confirmation?quoteId=${encodeURIComponent(data.quote.id)}`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Trial activation failed."); setBusy(false); }
  }

  async function purchase() {
    if (blocked) return;
    setBusy(true); setError("");
    try {
      const quoteResponse = await fetch("/api/subscription/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: selectedPlan, kind: "purchase" }) });
      const quoteData = await quoteResponse.json() as { quote?: { id: string }; error?: string; code?: string };
      if (quoteResponse.status === 401) { signInForPlan(); return; }
      if (!quoteResponse.ok || !quoteData.quote) throw new Error(quoteData.code === "already_subscribed" || quoteData.code === "upgrade_unavailable" ? messages.paymentErrors[quoteData.code] : quoteData.error || "Price calculation failed.");
      window.location.assign(`/${locale}/portal/subscription/confirmation?quoteId=${encodeURIComponent(quoteData.quote.id)}`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Checkout failed."); setBusy(false); }
  }

  return (
    <div className="purchase-panel">
      {!compact ? <><h2>{copy.choosePlan}</h2>
      <div className="purchase-plans">
        {plans.map((plan) => <label className={`purchase-plan ${selectedPlan === plan.id ? "selected" : ""}`} key={plan.id}><input type="radio" name={groupId} disabled={!isSelectable(plan)} checked={selectedPlan === plan.id} onChange={() => setSelectedPlan(plan.id)} /><span><strong>{plan.name}</strong>{plan.alreadySubscribed && <small>{messages.pricingDesign.alreadySubscribed}</small>}<small>{formatPlanPrice(locale, plan)}</small></span></label>)}
      </div></> : null}
      {subscribed && <p role="status">{messages.pricingDesign.alreadySubscribed}</p>}
      {error ? <p className="portal-form-error" role="alert">{error}</p> : null}
      <div className="purchase-actions">{allowTrial ? <button className="portal-button portal-button-secondary" disabled={busy || blocked} onClick={startTrial}>{copy.startTrial}</button> : null}<button className="portal-button portal-button-primary" disabled={busy || blocked} onClick={purchase}>{copy.buy}</button></div>
    </div>
  );
}

"use client";

import { useState } from "react";

export function UpgradePanel({ locale, subscriptionId }: { locale: "en-GB" | "zh-CN"; subscriptionId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isChinese = locale === "zh-CN";

  async function begin() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/subscription/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "upgrade", subscriptionId }) });
      const data = await response.json() as { quote?: { id: string }; error?: string };
      if (!response.ok || !data.quote) throw new Error(data.error || (isChinese ? "升级价格计算失败。" : "Upgrade price calculation failed."));
      window.location.assign(`/${locale}/portal/subscription/confirmation?quoteId=${encodeURIComponent(data.quote.id)}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : (isChinese ? "升级价格计算失败。" : "Upgrade price calculation failed."));
      setBusy(false);
    }
  }

  return <section className="pricing-upgrade-panel"><p className="portal-eyebrow">{isChinese ? "升级订阅" : "Upgrade subscription"}</p><h2>{isChinese ? "升级到 PC Everything" : "Upgrade to PC Everything"}</h2><p>{isChinese ? "系统会按当前分类订阅的剩余天数计算抵扣，并在确认页显示应付金额。" : "The service calculates a daily credit for the unused part of your current category subscription and shows the amount due on the confirmation page."}</p>{error ? <p className="portal-form-error" role="alert">{error}</p> : null}<button className="portal-button portal-button-primary" type="button" onClick={() => void begin()} disabled={busy}>{busy ? "..." : isChinese ? "计算升级价格" : "Calculate upgrade price"}</button></section>;
}

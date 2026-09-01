"use client";

import { FormEvent, useEffect, useState } from "react";

type Order = { id: string; userEmail: string; amountMinor: number; currency: string; status: "paid" | "pending" | "failed" | "canceled" | "refunded"; paymentMode: "demo" | "stripe"; createdAt: string; stripeCheckoutSessionId?: string | null; stripePaymentIntentId?: string | null; lastStripeStatus?: string | null; lastSyncedAt?: string | null; exceptionCode?: string | null; failureReason?: string | null; plan: { name: string } | null; subscription?: { state: string; validTo: string } | null; activities?: Array<{ action: string; result: string; reason: string | null; createdAt: string }> };

type Copy = { title: string; empty: string; refresh: string; refund: string; resynchronise: string; refunded: string; pending: string; demo: string; stripe: string; error: string; search: string; searchPlaceholder: string; status: string; paymentMode: string; all: string; paymentStatus: Record<string, string>; details: string; student: string; amount: string; orderDate: string; checkoutSession: string; paymentIntent: string; latestStripeStatus: string; lastSynced: string; activity: string; noActivity: string; export: string; confirmRefund: string };

export function OrderManager({ copy }: { copy: Copy }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  async function load() {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    if (paymentMode) params.set("paymentMode", paymentMode);
    const query = params.toString();
    const response = await fetch(`/api/backoffice/orders${query ? `?${query}` : ""}`, { cache: "no-store" });
    const data = await response.json() as { orders?: Order[]; error?: string };
    if (!response.ok) throw new Error(data.error || copy.error);
    setOrders(data.orders || []);
  }
  useEffect(() => { void load().catch((requestError) => setError(requestError instanceof Error ? requestError.message : copy.error)); }, [copy.error]);
  async function action(orderId: string, nextAction: "refund" | "resynchronise") {
    setBusyId(orderId); setError("");
    try {
      const response = await fetch("/api/backoffice/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, action: nextAction }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || copy.error);
      await load();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : copy.error); }
    finally { setBusyId(""); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void load().catch((requestError) => setError(requestError instanceof Error ? requestError.message : copy.error)); }
  const exportParams = new URLSearchParams();
  if (search.trim()) exportParams.set("search", search.trim());
  if (status) exportParams.set("status", status);
  if (paymentMode) exportParams.set("paymentMode", paymentMode);
  return <section className="backoffice-panel"><div className="backoffice-heading"><div><p className="portal-eyebrow">{copy.title}</p><h1>{copy.title}</h1></div><div className="backoffice-row-actions"><a className="portal-button portal-button-secondary" href={`/api/backoffice/orders/export${exportParams.toString() ? `?${exportParams}` : ""}`}>{copy.export}</a><button className="portal-button portal-button-secondary" onClick={() => void load().catch((requestError) => setError(requestError instanceof Error ? requestError.message : copy.error))} type="button">{copy.refresh}</button></div></div><form className="order-filters" onSubmit={submit}><label>{copy.search}<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy.searchPlaceholder} /></label><label>{copy.status}<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">{copy.all}</option>{Object.entries(copy.paymentStatus).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><label>{copy.paymentMode || "Payment mode"}<select value={paymentMode} onChange={(event) => setPaymentMode(event.target.value)}><option value="">{copy.all}</option><option value="demo">{copy.demo}</option><option value="stripe">{copy.stripe}</option></select></label><button className="portal-button portal-button-primary" type="submit">{copy.search}</button></form>{error ? <p className="portal-form-error" role="alert">{error}</p> : null}<div className="order-list">{orders.length ? orders.map((order) => <details className="order-row" key={order.id}><summary><div><strong>{order.plan?.name || order.id}</strong><span>{order.userEmail} · ${(order.amountMinor / 100).toFixed(2)} {order.currency.toUpperCase()} · {order.paymentMode === "demo" ? copy.demo : copy.stripe}</span><small>{new Date(order.createdAt).toLocaleString()} · {copy.paymentStatus[order.status] || order.status}</small></div><span className="order-state">{copy.details}</span></summary><div className="order-detail"><dl><dt>{copy.student}</dt><dd>{order.userEmail}</dd><dt>{copy.amount}</dt><dd>{(order.amountMinor / 100).toFixed(2)} {order.currency.toUpperCase()}</dd><dt>{copy.orderDate}</dt><dd>{new Date(order.createdAt).toLocaleString()}</dd><dt>{copy.checkoutSession}</dt><dd>{order.stripeCheckoutSessionId || "N/A"}</dd><dt>{copy.paymentIntent}</dt><dd>{order.stripePaymentIntentId || "N/A"}</dd><dt>{copy.latestStripeStatus}</dt><dd>{order.lastStripeStatus || "N/A"}</dd><dt>{copy.lastSynced}</dt><dd>{order.lastSyncedAt ? new Date(order.lastSyncedAt).toLocaleString() : "N/A"}</dd></dl>{order.failureReason ? <p className="portal-form-error">{order.failureReason}</p> : null}<div className="backoffice-row-actions">{order.status === "paid" && (order.paymentMode === "demo" || Boolean(order.stripePaymentIntentId)) ? <button className="portal-button portal-button-secondary" disabled={busyId === order.id} onClick={() => { if (window.confirm(copy.confirmRefund)) void action(order.id, "refund"); }} type="button">{copy.refund}</button> : null}{order.paymentMode === "stripe" && order.stripeCheckoutSessionId && order.status !== "refunded" ? <button className="portal-button portal-button-secondary" disabled={busyId === order.id} onClick={() => void action(order.id, "resynchronise")} type="button">{copy.resynchronise}</button> : null}{order.status === "refunded" ? <span className="order-state">{copy.refunded}</span> : order.status === "pending" ? <span className="order-state">{copy.pending}</span> : null}</div><h3>{copy.activity}</h3>{order.activities?.length ? <ul className="order-activity">{order.activities.map((item) => <li key={`${item.action}-${item.createdAt}`}><strong>{item.action}</strong> · {item.result} · {new Date(item.createdAt).toLocaleString()}{item.reason ? ` · ${item.reason}` : ""}</li>)}</ul> : <p>{copy.noActivity}</p>}</div></details>) : <p className="portal-empty">{copy.empty}</p>}</div></section>;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getMessages } from "@/lib/i18n/messages";
import { formatPlanPrice } from "@/lib/planPricing";
import { keepFocusInDialog } from "@/lib/dialogFocus";
import type { ManagedOrder, OrderAction, OrderActionResult } from "@/contracts/order-management";
import styles from "./pending-orders.module.css";

export function PendingOrders({ initialOrders, locale, returnOrderId }: { initialOrders: ManagedOrder[]; locale: "en-GB" | "zh-CN"; returnOrderId?: string }) {
  const [orders, setOrders] = useState(initialOrders), [busyId, setBusyId] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [cancelId, setCancelId] = useState<string | null>(null);
  const lock = useRef(false), checked = useRef(new Set<string>()), latest = useRef(orders);
  latest.current = orders;
  const dialog = useRef<HTMLDialogElement>(null), router = useRouter();
  const text = getMessages(locale).orderManagement;
  useEffect(() => { setOrders(initialOrders); }, [initialOrders]);
  const signIn = useCallback(() => window.location.assign(`/${locale}/portal/sign-in?returnTo=${encodeURIComponent(`/${locale}/account/my-learning/subscription`)}`), [locale]);
  const run = useCallback(async (id: string, action: OrderAction, automatic = false, signal?: AbortSignal) => {
    if (lock.current) return;
    lock.current = true; setBusyId(id);
    if (!automatic) { setError(""); setNotice(""); }
    try {
      const response = await fetch(`/api/my-learning/orders/${encodeURIComponent(id)}?locale=${locale}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }), signal,
      });
      if (response.status === 401) { signIn(); return; }
      const body = await response.json() as { data?: OrderActionResult; message?: string };
      if (!response.ok || !body.data?.order) throw new Error(body.message || text.errors.payment_unavailable);
      const result = body.data;
      setOrders(items => items.map(item => item.id === id ? result.order : item));
      if (action === "resume" && result.checkoutUrl) { window.location.assign(result.checkoutUrl); return; }
      if (!automatic) setNotice(action === "cancel" && result.order.status === "pending" ? text.notCanceled : action === "resume" && result.order.status === "pending" ? text.notResumed : text.updated);
      if (action === "cancel") setCancelId(null);
      if (result.order.status !== "pending") router.refresh();
      return result.order;
    } catch (failure) {
      if (!signal?.aborted) setError(failure instanceof Error ? failure.message : text.errors.payment_unavailable);
    } finally { lock.current = false; setBusyId(""); }
  }, [locale, router, signIn, text]);

  useEffect(() => {
    const controller = new AbortController();
    // Bound automatic provider work; every remaining order keeps its own check action.
    const candidates = latest.current.filter(order => order.status === "pending" && !checked.current.has(order.id))
      .sort((a, b) => Number(b.id === returnOrderId) - Number(a.id === returnOrderId)).slice(0, 5);
    // Defer startup so StrictMode's setup/cleanup rehearsal cannot consume the queue.
    const start = setTimeout(() => { void (async () => { for (const order of candidates) {
      while (lock.current && !controller.signal.aborted) await new Promise(resolve => setTimeout(resolve, 50));
      if (controller.signal.aborted) break;
      const result = await run(order.id, "check", true, controller.signal);
      if (result) checked.current.add(order.id);
    } })(); }, 0);
    return () => { clearTimeout(start); controller.abort(); };
  }, [returnOrderId, run]);
  useEffect(() => {
    if (!returnOrderId) return;
    let attempts = 0;
    const timer = setInterval(() => {
      const current = latest.current.find(order => order.id === returnOrderId);
      if (!current || current.status !== "pending" || ++attempts > 15) { clearInterval(timer); return; }
      if (current.state === "processing" || current.state === "synchronising" || current.state === "unverified") void run(current.id, "check", true);
    }, 2000);
    return () => clearInterval(timer);
  }, [returnOrderId, run]);
  useEffect(() => {
    if (returnOrderId) document.getElementById(`order-${returnOrderId}`)?.scrollIntoView({ block: "center" });
  }, [returnOrderId]);
  useEffect(() => {
    const element = dialog.current;
    if (!cancelId || !element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    return () => { element.close(); previous?.focus(); };
  }, [cancelId]);

  async function refresh() {
    if (lock.current) return;
    lock.current = true; setBusyId("list"); setError("");
    try {
      const response = await fetch(`/api/my-learning/orders?locale=${locale}`, { cache: "no-store" });
      if (response.status === 401) { signIn(); return; }
      const body = await response.json() as { data?: { orders: ManagedOrder[] }; message?: string };
      if (!response.ok || !body.data?.orders) throw new Error(body.message || text.errors.payment_unavailable);
      setOrders(body.data.orders); router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : text.errors.payment_unavailable); }
    finally { lock.current = false; setBusyId(""); }
  }
  const pending = orders.filter(order => order.status === "pending");
  const closed = orders.filter(order => order.status === "failed" || order.status === "canceled");
  const date = (value: string) => new Date(value).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const card = (order: ManagedOrder) => <article key={order.id} id={`order-${order.id}`} className={styles.card} data-order-id={order.id} data-state={order.state} tabIndex={-1}>
    <div className={styles.heading}><div><h3>{order.name}</h3><p>{text.kinds[order.kind]}{order.termMonths ? ` · ${text.months.replace("{count}", String(order.termMonths))}` : ""}</p></div><strong>{formatPlanPrice(locale, order)}</strong></div>
    <strong className={styles.status} aria-live="polite">{text.states[order.state]}</strong>
    <dl><div><dt>{text.orderNumber}</dt><dd>{order.id}</dd></div><div><dt>{text.created}</dt><dd>{date(order.createdAt)}</dd></div>
      {order.expiresAt && <div><dt>{text.deadline}</dt><dd>{date(order.expiresAt)}</dd></div>}
      {order.checkedAt && <div><dt>{text.checked}</dt><dd>{date(order.checkedAt)}</dd></div>}</dl>
    {order.reason && <p className={styles.explanation}>{text.reasons[order.reason]}</p>}
    <div className={styles.actions}>
      {order.status === "pending" ? <>
        {order.canResume && <button type="button" disabled={Boolean(busyId)} onClick={() => void run(order.id, "resume")}>{text.resume}</button>}
        {order.canCancel && <button type="button" disabled={Boolean(busyId)} onClick={() => { setError(""); setCancelId(order.id); }}>{text.cancel}</button>}
        <button type="button" disabled={Boolean(busyId)} onClick={() => void run(order.id, "check")}>{busyId === order.id ? text.checking : text.check}</button>
      </> : <Link href={`/${locale}/subscription`}>{text.viewPlans}</Link>}
      <Link prefetch={false} href={`/${locale}/account/my-learning/support?orderId=${encodeURIComponent(order.id)}`}>{text.support}</Link>
    </div>
  </article>;
  return <section className={styles.orders} aria-labelledby="pending-orders-title">
    <div className={styles.heading}><h2 id="pending-orders-title">{text.title}{pending.length ? ` (${pending.length})` : ""}</h2><button type="button" disabled={Boolean(busyId)} onClick={() => void refresh()}>{text.refresh}</button></div>
    {error && !cancelId && <p role="alert" className="portal-form-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className={styles.list}>{pending.length ? pending.map(card) : <p>{text.empty}</p>}</div>
    {closed.length > 0 && <details className={styles.history}><summary>{text.history} ({closed.length})</summary><div className={styles.list}>{closed.map(card)}</div></details>}
    {cancelId && <dialog ref={dialog} className={styles.dialog} aria-labelledby="cancel-order-title" aria-describedby="cancel-order-description" onKeyDown={keepFocusInDialog} onCancel={event => { event.preventDefault(); if (!busyId) setCancelId(null); }}>
      <h2 id="cancel-order-title">{text.cancelTitle}</h2><p id="cancel-order-description">{text.cancelDescription}</p>
      {error && <p role="alert" className="portal-form-error">{error}</p>}
      <div className={styles.actions}><button type="button" disabled={Boolean(busyId)} onClick={() => void run(cancelId, "cancel")}>{text.confirmCancel}</button><button type="button" disabled={Boolean(busyId)} onClick={() => setCancelId(null)}>{text.keep}</button></div>
    </dialog>}
  </section>;
}

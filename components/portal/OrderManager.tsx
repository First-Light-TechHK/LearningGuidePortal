"use client";

import { App, Alert, Button, Card, Descriptions, Drawer, Empty, Form, Input, Pagination, Select, Space, Spin, Table, Tag } from "antd";
import type { TableProps } from "antd";
import { useEffect, useRef, useState } from "react";
import { formatPlanPrice } from "@/lib/planPricing";
import { getMessages } from "@/lib/i18n/messages";
import { getCourseManagementMessages } from "@/lib/i18n/courseManagementMessages";
import type { BackofficeOrder as Order } from "@/contracts/backoffice-ui";
import { useBackofficePopupContainer } from "@/components/backoffice/BackofficeProvider";

type Copy = ReturnType<typeof getMessages>["backoffice"]["orders"];

export function OrderManager({ copy, locale = "en-GB" }: { copy: Copy; locale?: "en-GB" | "zh-CN" }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const version = useRef(0), actionLock = useRef(false);
  const { modal } = App.useApp();
  const getContainer = useBackofficePopupContainer();
  const common = getCourseManagementMessages(locale);

  function parameters() {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    if (paymentMode) params.set("paymentMode", paymentMode);
    return params;
  }
  async function load() {
    const request = ++version.current;
    setLoading(true); setError("");
    try {
      const query = parameters().toString();
      const response = await fetch(`/api/backoffice/orders${query ? `?${query}` : ""}`, { cache: "no-store" });
      const data = await response.json() as { orders?: Order[]; error?: string };
      if (!response.ok) throw new Error(data.error || copy.error);
      if (request === version.current) { setOrders(data.orders || []); setPage(1); return true; }
    } catch (requestError) {
      if (request === version.current) setError(requestError instanceof Error ? requestError.message : copy.error);
    } finally { if (request === version.current) setLoading(false); }
    return false;
  }
  useEffect(() => { void load(); return () => { ++version.current; }; }, [copy.error]);
  async function action(orderId: string, nextAction: "refund" | "resynchronise") {
    if (actionLock.current) return;
    actionLock.current = true; setBusyId(orderId); setError("");
    try {
      const response = await fetch("/api/backoffice/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, action: nextAction }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || copy.error);
      await load();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : copy.error); }
    finally { actionLock.current = false; setBusyId(""); }
  }
  function confirmRefund(order: Order) {
    modal.confirm({ title: copy.confirmRefund, getContainer, okText: copy.refund, cancelText: common.cancel,
      okButtonProps: { danger: true }, onOk: () => action(order.id, "refund") });
  }
  const state = (order: Order) => <Tag color={order.status === "paid" ? "success" : order.status === "failed" ? "error" : order.status === "pending" ? "processing" : "default"}>{copy.paymentStatus[order.status]}</Tag>;
  const actions = (order: Order) => <Space wrap>
    {order.status === "paid" && (order.paymentMode === "demo" || Boolean(order.stripePaymentIntentId)) && <Button danger disabled={Boolean(busyId)} loading={busyId === order.id} onClick={() => confirmRefund(order)}>{copy.refund}</Button>}
    {order.paymentMode === "stripe" && order.stripeCheckoutSessionId && order.status !== "refunded" && <Button disabled={Boolean(busyId)} loading={busyId === order.id} onClick={() => void action(order.id, "resynchronise")}>{copy.resynchronise}</Button>}
  </Space>;
  const detail = (order: Order) => <div className="bo-detail">
    <Descriptions column={1} size="small" items={[
      { key: "student", label: copy.student, children: order.userEmail },
      { key: "amount", label: copy.amount, children: formatPlanPrice(locale, order) },
      { key: "created", label: copy.orderDate, children: new Date(order.createdAt).toLocaleString(locale) },
      { key: "checkout", label: copy.checkoutSession, children: order.stripeCheckoutSessionId || common.none },
      { key: "intent", label: copy.paymentIntent, children: order.stripePaymentIntentId || common.none },
      { key: "stripe", label: copy.latestStripeStatus, children: order.lastStripeStatus || common.none },
      { key: "synced", label: copy.lastSynced, children: order.lastSyncedAt ? new Date(order.lastSyncedAt).toLocaleString(locale) : common.none },
    ]}/>
    {order.failureReason && <Alert type="error" title={order.failureReason} showIcon/>}
    {actions(order)}
    <div><h3>{copy.activity}</h3>{order.activities?.length ? <ul>{order.activities.map((item, index) => <li key={`${item.createdAt}-${index}`}><strong>{item.action}</strong> · {item.result} · {new Date(item.createdAt).toLocaleString(locale)}{item.reason ? ` · ${item.reason}` : ""}</li>)}</ul> : <p>{copy.noActivity}</p>}</div>
  </div>;
  const columns: TableProps<Order>["columns"] = [
    { title: getMessages(locale).learning.plan, key: "plan", render: (_, order) => order.plan?.name || order.id },
    { title: copy.student, dataIndex: "userEmail" },
    { title: copy.amount, key: "amount", render: (_, order) => formatPlanPrice(locale, order) },
    { title: copy.status, key: "status", render: (_, order) => state(order) },
    { title: copy.paymentMode, key: "mode", render: (_, order) => order.paymentMode === "demo" ? copy.demo : copy.stripe },
    { title: copy.orderDate, key: "created", render: (_, order) => new Date(order.createdAt).toLocaleString(locale) },
  ];
  const filters = (suffix: string) => <Form layout="vertical" className="bo-filters" onFinish={() => { void load().then(ok => { if (ok) setFiltersOpen(false); }); }}>
    <Form.Item label={copy.search} htmlFor={`order-search-${suffix}`}><Input id={`order-search-${suffix}`} value={search} onChange={event => setSearch(event.target.value)} placeholder={copy.searchPlaceholder}/></Form.Item>
    <Form.Item label={copy.status} htmlFor={`order-status-${suffix}`}><Select id={`order-status-${suffix}`} value={status} onChange={setStatus} options={[{value:"",label:copy.all},...Object.entries(copy.paymentStatus).map(([value,label])=>({value,label}))]}/></Form.Item>
    <Form.Item label={copy.paymentMode} htmlFor={`order-mode-${suffix}`}><Select id={`order-mode-${suffix}`} value={paymentMode} onChange={setPaymentMode} options={[{value:"",label:copy.all},{value:"demo",label:copy.demo},{value:"stripe",label:copy.stripe}]}/></Form.Item>
    <Button type="primary" htmlType="submit" loading={loading}>{copy.search}</Button>
  </Form>;
  return <section className="backoffice-panel bo-page" aria-busy={loading}>
    <div className="bo-heading"><h1>{copy.title}</h1><Space wrap>
      <Button href={`/api/backoffice/orders/export${parameters().size ? `?${parameters()}` : ""}`}>{copy.export}</Button>
      <Button loading={loading} onClick={() => void load()}>{copy.refresh}</Button>
      <Button className="bo-mobile" onClick={() => setFiltersOpen(true)}>{copy.search}</Button>
    </Space></div>
    <div className="bo-desktop">{filters("desktop")}</div>
    <Drawer title={copy.search} open={filtersOpen} onClose={() => setFiltersOpen(false)} getContainer={getContainer} size="default" styles={{ wrapper: { maxWidth: "100vw" } }} destroyOnHidden>{filters("mobile")}</Drawer>
    {error && <Alert type="error" title={error} showIcon/>}
    <div className="bo-desktop"><Table<Order> rowKey="id" dataSource={orders} columns={columns} loading={loading} locale={{emptyText:copy.empty}} scroll={{x:900}} pagination={{current:page,pageSize:10,onChange:setPage,showSizeChanger:false}} expandable={{expandedRowRender:detail,columnTitle:copy.details,columnWidth:100}}/></div>
    <div className="bo-mobile"><Spin spinning={loading}><div className="bo-mobile-cards">
      {!loading && !orders.length && !error && <Empty description={copy.empty}/>}
      {orders.slice((page-1)*10,page*10).map(order => <Card key={order.id} size="small"><div className="bo-card-heading"><h2>{order.plan?.name || order.id}</h2>{state(order)}</div><p>{order.userEmail} · {formatPlanPrice(locale,order)}</p><details><summary>{copy.details}</summary>{detail(order)}</details></Card>)}
      {orders.length > 10 && <Pagination simple current={page} pageSize={10} total={orders.length} onChange={setPage}/>}
    </div></Spin></div>
  </section>;
}

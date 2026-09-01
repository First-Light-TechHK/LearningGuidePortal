"use client";

import { useState } from "react";

type Notification = { id: string; title: string; body: string; readAt: string | null; createdAt: string };

export function NotificationList({ initialNotifications, copy }: { initialNotifications: Notification[]; copy: { markRead: string; markUnread: string; empty: string } }) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [error, setError] = useState("");

  async function toggle(item: Notification) {
    setError("");
    const response = await fetch("/api/my-learning/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notificationId: item.id, read: !item.readAt }) });
    const data = await response.json() as { notification?: Notification; error?: string };
    if (!response.ok || !data.notification) { setError(data.error || "Notification update failed."); return; }
    setNotifications((current) => current.map((notification) => notification.id === item.id ? data.notification as Notification : notification));
  }

  return <div className="notification-list">{notifications.length ? notifications.map((item) => <article className={`notification-row ${item.readAt ? "read" : "unread"}`} key={item.id}><div><strong>{item.title}</strong><span>{item.body}</span><small>{new Date(item.createdAt).toLocaleString()}</small></div><button className="portal-button portal-button-secondary" onClick={() => void toggle(item)} type="button">{item.readAt ? copy.markUnread : copy.markRead}</button></article>) : <p className="portal-empty">{copy.empty}</p>}{error ? <p className="portal-form-error" role="alert">{error}</p> : null}</div>;
}

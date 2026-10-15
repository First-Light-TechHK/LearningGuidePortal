"use client";

import { useState } from "react";
import type { Locale } from "@/lib/i18n/config";

type Notification = { id: string; title: string; body: string; readAt: string | null; createdAt: string };

// F-4 (dev audit 2026-10-14): the row timestamp used to format with the browser's own
// default locale, so a zh-CN user on an en-US browser read a 12-hour browser-locale
// stamp - the same defect hunt L6 fixed in the Live Session room chat. Formatting now
// follows the application locale (an explicit prop; this module has no next-intl
// provider to read from, and every other portal component receives its Locale the same
// way) and both app locales render 24-hour time. An unparseable stamp echoes back
// unchanged instead of throwing, mirroring chatLabel in modules/group-study/roomData.ts.
export function notificationDateLabel(locale: string, createdAt: string) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function NotificationList({ locale, initialNotifications, copy }: { locale: Locale; initialNotifications: Notification[]; copy: { markRead: string; markUnread: string; empty: string } }) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [error, setError] = useState("");

  async function toggle(item: Notification) {
    setError("");
    const response = await fetch("/api/my-learning/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notificationId: item.id, read: !item.readAt }) });
    const data = await response.json() as { notification?: Notification; error?: string };
    if (!response.ok || !data.notification) { setError(data.error || "Notification update failed."); return; }
    setNotifications((current) => current.map((notification) => notification.id === item.id ? data.notification as Notification : notification));
  }

  return <div className="notification-list">{notifications.length ? notifications.map((item) => <article className={`notification-row ${item.readAt ? "read" : "unread"}`} key={item.id}><div><strong>{item.title}</strong><span>{item.body}</span><small>{notificationDateLabel(locale, item.createdAt)}</small></div><button className="portal-button portal-button-secondary" onClick={() => void toggle(item)} type="button">{item.readAt ? copy.markUnread : copy.markRead}</button></article>) : <p className="portal-empty">{copy.empty}</p>}{error ? <p className="portal-form-error" role="alert">{error}</p> : null}</div>;
}

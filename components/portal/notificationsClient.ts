import type { LearnerNotificationItem } from "@/services/notifications/types";
import type { Locale } from "@/lib/i18n/config";

/** The bell and the Notification Center keep the unread count equal through this window event. */
export const UNREAD_EVENT = "lg:notifications-unread";

export type NotificationPage = {
  items: LearnerNotificationItem[];
  unreadCount: number;
  total: number;
  nextCursor: string | null;
};

async function request<T extends { unreadCount: number }>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store" });
  let body: (T & { ok?: boolean }) | null = null;
  try { body = await response.json(); } catch { /* a non-JSON body is an error below */ }
  if (!response.ok || !body || body.ok === false) throw new Error(`Notification request failed (${response.status}).`);
  window.dispatchEvent(new CustomEvent(UNREAD_EVENT, { detail: body.unreadCount }));
  return body;
}

export function fetchNotifications({ filter, limit, cursor, locale, signal }: {
  filter: "all" | "unread";
  limit: number;
  cursor?: string | null;
  locale: Locale;
  signal?: AbortSignal;
}) {
  const query = new URLSearchParams({ filter, limit: String(limit), locale });
  if (cursor) query.set("cursor", cursor);
  return request<NotificationPage>(`/api/my-learning/notifications?${query}`, { signal });
}

export function setNotificationRead(id: string, read: boolean, { keepalive = false }: { keepalive?: boolean } = {}) {
  return request<{ notification: { id: string; read: boolean; readAt: string | null }; unreadCount: number }>("/api/my-learning/notifications/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notificationId: id, read }),
    keepalive,
  });
}

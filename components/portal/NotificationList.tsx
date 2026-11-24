"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, BookOpen, CreditCard, Megaphone, MessageSquare, Users, type LucideIcon } from "lucide-react";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import type { LearnerNotificationItem, NotificationCategory } from "@/services/notifications/types";
import { fetchNotifications, setNotificationRead, UNREAD_EVENT, type NotificationPage } from "./notificationsClient";
import s from "./notifications.module.css";

const PAGE_SIZE = 20;

const CATEGORY_STYLE: Record<NotificationCategory, { Icon: LucideIcon; color: string; background: string }> = {
  subscription: { Icon: CreditCard, color: "#155dfc", background: "#e8f1ff" },
  study_group: { Icon: Users, color: "#7c3aed", background: "#f3effe" },
  announcement: { Icon: Megaphone, color: "#ea580c", background: "#fff4e5" },
  support: { Icon: MessageSquare, color: "#16a34a", background: "#e8f8ee" },
  course: { Icon: BookOpen, color: "#db2777", background: "#fdeef6" },
};

export function NotificationCategoryIcon({ category, size, className }: { category: NotificationCategory; size: number; className: string }) {
  const { Icon, color, background } = CATEGORY_STYLE[category] || CATEGORY_STYLE.announcement;
  return <span className={`${s.icon} ${className}`} style={{ background, color } as CSSProperties} aria-hidden="true"><Icon size={size} strokeWidth={1.8} aria-hidden="true" /></span>;
}

/** A button link is only followed when it is a site path or an https URL. */
export function safeNotificationLink(link: string | null): string | null {
  return link && (link.startsWith("/") && !link.startsWith("//") || link.startsWith("https://")) ? link : null;
}

/** Other-origin links open in a new tab. */
export function externalLinkProps(href: string) {
  return href.startsWith("https://") ? { target: "_blank", rel: "noopener noreferrer" } : {};
}

type Copy = ReturnType<typeof getMessages>["notificationsPage"];
type Filter = "all" | "unread";
type Problem = { kind: "load"; retry: () => void } | { kind: "update" } | null;

export function NotificationList({ locale, initial, copy }: { locale: Locale; initial: NotificationPage; copy: Copy }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState({ items: initial.items, total: initial.total, nextCursor: initial.nextCursor });
  const [unreadCount, setUnreadCount] = useState(initial.unreadCount);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const onUnread = (event: Event) => setUnreadCount(Number((event as CustomEvent<number>).detail) || 0);
    window.addEventListener(UNREAD_EVENT, onUnread);
    return () => { window.removeEventListener(UNREAD_EVENT, onUnread); controller.current?.abort(); };
  }, []);

  // Deep link from the bell: #n-<id> scrolls to the row and focuses it.
  useEffect(() => {
    const row = location.hash.startsWith("#n-") ? document.getElementById(location.hash.slice(1)) : null;
    if (row) { row.scrollIntoView({ block: "center" }); row.focus(); }
  }, []);

  useEffect(() => {
    if (!focusId) return;
    document.getElementById(`n-${focusId}`)?.focus();
    setFocusId(null);
  }, [focusId, page.items]);

  const patchRow = useCallback((id: string, read: boolean, readAt: string | null) => {
    setPage((current) => ({ ...current, items: current.items.map((item) => item.id === id ? { ...item, read, unread: !read, readAt } : item) }));
  }, []);

  async function changeFilter(next: Filter) {
    if (next === filter || busy) return;
    const previous = filter;
    setFilter(next); setProblem(null); setBusy(true);
    controller.current?.abort();
    const current = controller.current = new AbortController();
    try {
      const result = await fetchNotifications({ filter: next, limit: PAGE_SIZE, locale, signal: current.signal });
      setPage({ items: result.items, total: result.total, nextCursor: result.nextCursor });
    } catch {
      if (current.signal.aborted) return;
      setFilter(previous);
      setProblem({ kind: "load", retry: () => void changeFilter(next) });
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }

  async function loadMore() {
    if (!page.nextCursor || loadingMore) return;
    setLoadingMore(true); setProblem(null);
    try {
      const result = await fetchNotifications({ filter, limit: PAGE_SIZE, cursor: page.nextCursor, locale });
      const known = new Set(page.items.map((item) => item.id));
      const added = result.items.filter((item) => !known.has(item.id));
      setPage({ items: [...page.items, ...added], total: result.total, nextCursor: result.nextCursor });
      if (added[0]) setFocusId(added[0].id);
    } catch {
      setProblem({ kind: "load", retry: () => void loadMore() });
    } finally {
      setLoadingMore(false);
    }
  }

  async function toggle(item: LearnerNotificationItem) {
    setPending(item.id); setProblem(null);
    try {
      const result = await setNotificationRead(item.id, !item.read);
      patchRow(item.id, result.notification.read, result.notification.readAt);
    } catch {
      setProblem({ kind: "update" });
    } finally {
      setPending(null);
    }
  }

  function followLink(item: LearnerNotificationItem) {
    if (!item.unread) return;
    // Not awaited: the browser is already following the link.
    setNotificationRead(item.id, true, { keepalive: true }).then((result) => patchRow(item.id, result.notification.read, result.notification.readAt)).catch(() => undefined);
  }

  const { items, total, nextCursor } = page;
  return <div className={s.center}>
    <div className={s.filters} role="group" aria-label={copy.filterLabel}>
      <button type="button" className={s.pill} aria-pressed={filter === "all"} onClick={() => void changeFilter("all")}>{copy.filterAll}</button>
      <button type="button" className={s.pill} aria-pressed={filter === "unread"} onClick={() => void changeFilter("unread")}>{copy.filterUnread.replace("{count}", String(unreadCount))}</button>
    </div>
    {problem ? <p className={`portal-form-error ${s.alert}`} role="alert">
      {problem.kind === "update" ? copy.updateError : copy.loadError}
      {problem.kind === "load" ? <button type="button" className={s.textButton} onClick={problem.retry}>{copy.retry}</button> : null}
    </p> : null}
    {items.length ? <ul className={s.list} aria-busy={busy}>
      {items.map((item) => {
        const link = item.buttonText ? safeNotificationLink(item.buttonLink) : null;
        return <li key={item.id} id={`n-${item.id}`} tabIndex={-1} className={`${s.row} ${item.unread ? s.rowUnread : ""}`}>
          <span className={s.dotCell}>{item.unread ? <><span className={s.dot} aria-hidden="true" /><span className={s.srOnly}>{copy.unreadTag}</span></> : null}</span>
          <NotificationCategoryIcon category={item.category} size={18} className={s.rowIcon} />
          <div className={s.content}>
            <p className={s.meta}><span className={s.metaCategory}>{item.categoryLabel}</span> · <span>{item.displayTime}</span></p>
            <h2 className={s.title}>{item.title}</h2>
            <p className={s.body}>{item.body}</p>
            {link ? <a className={s.action} href={link} {...externalLinkProps(link)} onClick={() => followLink(item)}>{item.buttonText}<ArrowRight size={14} aria-hidden="true" /></a> : null}
          </div>
          {item.isTest ? null : <button type="button" className={s.markButton} disabled={pending === item.id} aria-busy={pending === item.id} onClick={() => void toggle(item)}>{item.read ? copy.markUnread : copy.markRead}</button>}
        </li>;
      })}
    </ul> : <p className={s.emptyState}>{filter === "unread" ? copy.emptyUnread : copy.empty}</p>}
    {total > 0 ? <div className={s.more}>
      {copy.showing.replace("{shown}", String(items.length)).replace("{total}", String(total))}
      {nextCursor ? <> · <button type="button" className={s.textButton} disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? copy.loading : copy.loadMore}</button></> : null}
    </div> : null}
  </div>;
}

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell, LoaderCircle } from "lucide-react";
import { Dropdown } from "antd";
import { usePathname } from "next/navigation";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import type { LearnerNotificationItem } from "@/services/notifications/types";
import { PortalProvider } from "./ui/PortalProvider";
import { NotificationCategoryIcon, externalLinkProps, safeNotificationLink } from "./NotificationList";
import { fetchNotifications, setNotificationRead, UNREAD_EVENT } from "./notificationsClient";
import s from "./notifications.module.css";

const DROPDOWN_ITEMS = 5;

export function NotificationBell({ locale }: { locale: Locale }) {
  return <PortalProvider locale={locale}><NotificationBellContent locale={locale} /></PortalProvider>;
}

function NotificationBellContent({ locale }: { locale: Locale }) {
  const copy = getMessages(locale).notificationsPage;
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<LearnerNotificationItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [shift, setShift] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement | null>(null);
  const request = useRef<AbortController | null>(null);
  const visible = useRef(false);
  const focused = useRef(false);

  // One request gives the count and the five rows. Background refreshes stay silent when they fail.
  const load = useCallback(async () => {
    request.current?.abort();
    const current = request.current = new AbortController();
    try {
      const result = await fetchNotifications({ filter: "all", limit: DROPDOWN_ITEMS, locale, signal: current.signal });
      if (current.signal.aborted) return;
      setItems(result.items); setCount(result.unreadCount); setLoaded(true); setFailed(false);
    } catch {
      if (!current.signal.aborted && visible.current) setFailed(true);
    }
  }, [locale]);

  useEffect(() => { void load(); }, [load, pathname]);

  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => { if (event.persisted) void load(); };
    const onUnread = (event: Event) => setCount(Number((event as CustomEvent<number>).detail) || 0);
    window.addEventListener("pageshow", onShow);
    window.addEventListener(UNREAD_EVENT, onUnread);
    return () => {
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener(UNREAD_EVENT, onUnread);
      request.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    visible.current = open;
    if (!open) { focused.current = false; return; }
    setFailed(false);
    void load();
  }, [open, load]);

  // After data (or the error) is shown, focus moves to the first item, or to the footer link when the list is empty.
  useEffect(() => {
    if (!open || focused.current || !(loaded || failed)) return;
    const first = panel.current?.querySelector<HTMLElement>("a");
    if (first) { first.focus(); focused.current = true; }
  }, [open, loaded, failed, items]);

  function follow(item: LearnerNotificationItem) {
    // Not awaited: the browser is already following the link.
    if (item.unread) setNotificationRead(item.id, true, { keepalive: true }).catch(() => undefined);
    setOpen(false);
  }

  const showAll = `/${locale}/account/my-learning/notifications`;
  const unreadText = copy.unreadCount.replace("{count}", String(count));
  const showLoading = !loaded && !failed;
  // A failed refresh while data is shown replaces the list; the badge keeps its last value.

  function onKeyDown(event: React.KeyboardEvent) {
    if (!open) return;
    if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); return; }
    if (event.key !== "Tab" || !panel.current?.contains(event.target as Node)) return;
    // The dropdown library closes the panel on every Tab. Keep it open while focus moves inside, and close it at either end.
    event.nativeEvent.stopPropagation();
    const stops = panel.current.querySelectorAll("a, button");
    if (event.target === stops[event.shiftKey ? 0 : stops.length - 1]) { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
  }

  return <div className={s.bell} onKeyDown={onKeyDown}>
    <Dropdown
      trigger={["click"]} open={open} placement="bottomRight" destroyOnHidden
      align={{ offset: [shift, 12] }} classNames={{ root: s.dropdownRoot }}
      onOpenChange={(value) => {
        // The panel's right edge sits on the header's right edge, and keeps a 12px gutter on narrow screens.
        const button = trigger.current?.getBoundingClientRect();
        const inner = trigger.current?.closest(".portal-header-inner")?.getBoundingClientRect();
        if (value && button && inner) setShift(Math.max(0, Math.min(inner.right, window.innerWidth - 12) - button.right));
        setOpen(value);
      }}
      menu={{ items: [] }}
      popupRender={() => <section className={s.panel} aria-label={copy.dropdownTitle} ref={(node) => { panel.current = node; }}>
        <div className={s.panelHeader}>
          <h2 className={s.panelTitle}>{copy.dropdownTitle}</h2>
          {count > 0 ? <span className={s.panelCount}>{unreadText}</span> : null}
        </div>
        {showLoading ? <div className={s.state} aria-busy="true"><LoaderCircle className={s.spin} size={20} aria-hidden="true" /><span className={s.srOnly}>{copy.loading}</span></div>
          : failed ? <div className={s.stateError}><p role="alert">{copy.loadError}</p><button type="button" className={s.textButton} onClick={() => { setFailed(false); void load(); }}>{copy.retry}</button></div>
          : items.length === 0 ? <div className={s.state}><p>{copy.empty}</p></div>
          : <ul className={s.panelList}>
            {items.map((item) => {
              const link = safeNotificationLink(item.buttonLink);
              const href = link || `${showAll}#n-${item.id}`;
              return <li key={item.id}>
                <a className={`${s.item} ${item.unread ? s.itemUnread : ""}`} href={href} {...(link ? externalLinkProps(link) : {})} onClick={() => follow(item)}>
                  <NotificationCategoryIcon category={item.category} size={16} className={s.itemIcon} />
                  <span className={s.itemBody}>
                    <span className={s.itemTop}>
                      <span className={s.itemCategory}>{item.categoryLabel}</span>
                      <span className={s.itemMeta}>{item.displayTime}{item.unread ? <><span className={s.dot} aria-hidden="true" /><span className={s.srOnly}>{copy.unreadTag}</span></> : null}</span>
                    </span>
                    <span className={s.itemTitle}>{item.title}</span>
                    <span className={s.itemText}>{item.body}</span>
                  </span>
                </a>
              </li>;
            })}
          </ul>}
        <a className={s.footerLink} href={showAll} onClick={() => setOpen(false)}>{copy.viewAll}</a>
      </section>}
    >
      <button ref={trigger} type="button" className={`portal-header-icon ${s.bellButton}`} aria-haspopup="true" aria-expanded={open}
        aria-label={count > 0 ? copy.bellLabelUnread.replace("{count}", String(count)) : copy.bellLabel}>
        <Bell size={18} strokeWidth={1.8} aria-hidden="true" />
        {count > 0 ? <span className={s.badge} aria-hidden="true">{count > 99 ? "99+" : count}</span> : null}
      </button>
    </Dropdown>
    <span className={s.srOnly} role="status" aria-live="polite">{count > 0 ? unreadText : ""}</span>
  </div>;
}

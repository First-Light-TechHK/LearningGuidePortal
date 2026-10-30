"use client";

import { App, ConfigProvider } from "antd";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import enGB from "antd/locale/en_GB";
import zhCN from "antd/locale/zh_CN";
import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import type { Locale } from "@/lib/i18n/config";
import "./backoffice-ui.css";

const PopupContainer = createContext<() => HTMLElement>(() => document.body);
const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
function subscribeToReducedMotion(onChange: () => void) {
  const query = window.matchMedia(reducedMotionQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const reducedMotionSnapshot = () => window.matchMedia(reducedMotionQuery).matches;
const serverMotionSnapshot = () => false;

/** Shared by Select, Modal, Drawer and context-bound confirmation dialogs. */
export function useBackofficePopupContainer() {
  return useContext(PopupContainer);
}

export function BackofficeProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const reducedMotion = useSyncExternalStore(subscribeToReducedMotion, reducedMotionSnapshot, serverMotionSnapshot);
  const getContainer = useCallback(() => root.current || document.body, []);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    // rc Portal locks body only for its own/body container. Our scoped popup
    // host is custom: retain scroll locking for every nested modal/drawer and
    // restore the exact prior inline values after the last dialog closes.
    let locked = false, overflow = "", padding = "";
    const restore = () => {
      if (!locked) return;
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = padding;
      locked = false;
    };
    const sync = () => {
      const visible = [...element.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')]
        .some(dialog => dialog.getClientRects().length > 0 && getComputedStyle(dialog).visibility !== "hidden");
      if (!visible) { restore(); return; }
      if (locked) return;
      overflow = document.body.style.overflow; padding = document.body.style.paddingRight;
      const gutter = window.innerWidth - document.documentElement.clientWidth;
      const currentPadding = getComputedStyle(document.body).paddingRight;
      document.body.style.overflow = "hidden";
      if (gutter > 0) document.body.style.paddingRight = `calc(${currentPadding} + ${gutter}px)`;
      locked = true;
    };
    const observer = new MutationObserver(sync);
    observer.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class", "aria-hidden"] });
    sync();
    return () => { observer.disconnect(); restore(); };
  }, []);
  return (
    <AntdRegistry hashPriority="high">
      <ConfigProvider
        prefixCls="lg-ant"
        button={{ autoInsertSpace: false, loadingIcon: <LoaderCircle size={16} aria-hidden="true" className="bo-loading-spin"/> }}
        locale={locale === "zh-CN" ? zhCN : enGB}
        getPopupContainer={getContainer}
        theme={{ token: {
          colorPrimary: "#155dfc", colorText: "#101828", colorTextSecondary: "#4a5565",
          colorBorder: "#e5e7eb", colorBgLayout: "#f9fafb", borderRadius: 10,
          controlHeight: 42, fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
          fontSize: 14,
          motion: !reducedMotion,
        } }}
      >
        <PopupContainer.Provider value={getContainer}>
          <div ref={root} className="backoffice-ui" data-backoffice-ui>
            <App message={{ getContainer }} notification={{ getContainer }}>{children}</App>
          </div>
        </PopupContainer.Provider>
      </ConfigProvider>
    </AntdRegistry>
  );
}

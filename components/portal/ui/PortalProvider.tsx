"use client";

import React from "react";

import { ConfigProvider } from "antd";
import enGB from "antd/locale/en_GB";
import zhCN from "antd/locale/zh_CN";
import { LoaderCircle } from "lucide-react";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { Locale } from "@/lib/i18n/config";

const PortalContext = createContext(false);
const query = "(prefers-reduced-motion: reduce)";
function subscribe(listener: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
const snapshot = () => window.matchMedia(query).matches;
const serverSnapshot = () => false;

/** Route scope; also supports the shared account menu on legacy learner routes. */
export function PortalProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const inherited = useContext(PortalContext);
  return inherited ? children : <PortalTheme locale={locale}>{children}</PortalTheme>;
}

function PortalTheme({ locale, children }: { locale: Locale; children: ReactNode }) {
  const reducedMotion = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return <ConfigProvider
    prefixCls="lg-ant"
    locale={locale === "zh-CN" ? zhCN : enGB}
    button={{ autoInsertSpace: false, loadingIcon: <LoaderCircle size={16} aria-hidden="true" className="portal-control-spinner" /> }}
    theme={{ inherit: false, token: {
      colorPrimary: "#155dfc", colorText: "#15233a", colorTextSecondary: "#64728b",
      colorBorder: "#d0d5dd", borderRadius: 8, controlHeight: 42,
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", fontSize: 14,
      motion: !reducedMotion,
    }, components: { Button: { fontWeight: 600, primaryShadow: "none", defaultShadow: "none" } } }}
  ><PortalContext.Provider value={true}>{children}</PortalContext.Provider></ConfigProvider>;
}

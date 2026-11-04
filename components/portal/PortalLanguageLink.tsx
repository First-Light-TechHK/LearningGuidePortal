"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import type { Locale } from "@/lib/i18n/config";

export function PortalLanguageLink({ locale, label }: { locale: Locale; label: string }) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const otherLocale = locale === "en-GB" ? "zh-CN" : "en-GB";
  const href = pathname.replace(/^\/(en-GB|zh-CN)(?=\/|$)/, `/${otherLocale}`);
  // The URL decides the page's language. The switch is also the user's choice
  // of language, so mail and the AI Tutor follow it. Signed out this answers
  // 401 and nothing changes; a failure never stops the page from switching.
  const remember = () => {
    void fetch("/api/me/locale", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale: otherLocale }) }).catch(() => undefined);
  };
  return <Link prefetch={false} className="portal-language" href={href + (query ? `?${query}` : "")} onClick={remember} aria-label={locale === "en-GB" ? "切换到简体中文" : "Switch to English (UK)"}><span>{label}</span><ChevronDown size={13} aria-hidden="true" /></Link>;
}

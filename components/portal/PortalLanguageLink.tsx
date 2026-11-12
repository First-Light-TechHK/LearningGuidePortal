"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Globe } from "lucide-react";
import type { Locale } from "@/lib/i18n/config";
import { lessonLanguageHref, saveBeforeLessonLanguageChange } from "@/lib/lessonLanguageNavigation";

export function PortalLanguageLink({ locale, label }: { locale: Locale; label: string }) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const otherLocale = locale === "en-GB" ? "zh-CN" : "en-GB";
  const destination = lessonLanguageHref(pathname, query, otherLocale);
  // The URL decides the page's language. The switch is also the user's choice
  // of language, so mail and the AI Tutor follow it. Signed out this answers
  // 401 and nothing changes; a failure never stops the page from switching.
  const remember = () => {
    void fetch("/api/me/locale", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale: otherLocale }) }).catch(() => undefined);
  };
  return <Link prefetch={false} className="portal-language" href={destination.href} onClick={event => {
    remember();
    if (!destination.lesson || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void saveBeforeLessonLanguageChange().then(() => window.location.assign(destination.href));
  }} aria-label={locale === "en-GB" ? "切换到简体中文" : "Switch to English (UK)"}><Globe className="portal-language-globe" size={14} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span><span className="portal-language-caret" aria-hidden="true" /></Link>;
}

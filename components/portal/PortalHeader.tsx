"use client";

import { AuthNavigationLink } from "@/components/portal/AuthNavigationLink";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { PortalSessionResponse } from "@/contracts/portal-session";
import { Bell } from "lucide-react";
import Image from "next/image";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { PortalLanguageLink } from "@/components/portal/PortalLanguageLink";
import { AccountMenu } from "@/components/portal/AccountMenu";

type HeaderSection = "courses" | "study-groups" | "my-learning" | "subscription";

export function PortalHeader({ locale, active, signedIn: initialSignedIn = false, displayName: initialName, avatarUrl: initialAvatar }: { locale: Locale; active?: HeaderSection; signedIn?: boolean; displayName?: string; avatarUrl?: string }) {
  const messages = getMessages(locale);
  const copy = messages.portal;
  const pathname = usePathname();
  const [identity, setIdentity] = useState({ signedIn: initialSignedIn, displayName: initialName, avatarUrl: initialAvatar });
  useEffect(() => {
    setIdentity({ signedIn: initialSignedIn, displayName: initialName, avatarUrl: initialAvatar });
    let controller: AbortController;
    const refresh = async () => {
      controller?.abort();
      const request = controller = new AbortController();
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin", signal: request.signal });
        if (!response.ok) return;
        const data = await response.json() as PortalSessionResponse;
        if (!data.ok || request.signal.aborted) return;
        setIdentity({ signedIn: Boolean(data.user), displayName: data.user?.nickname, avatarUrl: data.user?.avatarUrl || undefined });
      } catch { /* Keep the server-rendered identity on transient failures. */ }
    };
    void refresh();
    const onRestore = (event: PageTransitionEvent) => { if (event.persisted) void refresh(); };
    window.addEventListener("pageshow", onRestore);
    return () => { controller?.abort(); window.removeEventListener("pageshow", onRestore); };
  }, [pathname, initialSignedIn, initialName, initialAvatar]);
  const { signedIn, displayName, avatarUrl } = identity;

  return (
    <header className={`portal-header ${signedIn ? "portal-header--signed-in" : "portal-header--visitor"}`}>
      <div className="portal-header-inner">
        <Link prefetch={false} className="portal-brand" href={`/${locale}/portal`}>
          <span className="portal-brand-mark" aria-hidden="true"><Image src="/portal/figma-logo.svg" width={24} height={24} alt="" /></span>
          <span>{messages.brand}</span>
        </Link>
        <nav className="portal-nav" aria-label="Primary navigation">
          <Link prefetch={false} className={active === "courses" ? "active" : ""} href={`/${locale}/portal/courses`}>{copy.navigation.courses}</Link>
          <Link prefetch={false} className={active === "study-groups" ? "active" : ""} href={`/${locale}/portal/study-groups`}>{copy.navigation.studyGroups}</Link>
          {/* Resolve the current Session and subscription coverage on every entry, including same-page reentry. */}
          <a className={active === "subscription" ? "active" : ""} href={`/${locale}/subscription`}>{copy.navigation.pricing}</a>
        </nav>
        <div className="portal-header-actions">
          <Suspense fallback={<span className="portal-language">{copy.navigation.language}</span>}><PortalLanguageLink locale={locale} label={copy.navigation.language} /></Suspense>
          {signedIn ? null : <Suspense fallback={<Link prefetch={false} className="portal-header-link" href={`/${locale}/portal/sign-in`}>{copy.signIn}</Link>}><AuthNavigationLink locale={locale} className="portal-header-link">{copy.signIn}</AuthNavigationLink></Suspense>}
          {signedIn ? <span className="portal-header-icon" role="img" aria-label={copy.notifications}><Bell size={18} strokeWidth={1.8} aria-hidden="true" /></span> : null}
          {signedIn ? null : <Suspense fallback={<Link prefetch={false} className="portal-button portal-button-primary portal-header-cta" href={`/${locale}/portal/sign-up`}>{copy.navigation.getStarted}</Link>}><AuthNavigationLink locale={locale} mode="sign-up" className="portal-button portal-button-primary portal-header-cta">{copy.navigation.getStarted}</AuthNavigationLink></Suspense>}
          {signedIn ? <AccountMenu locale={locale} displayName={displayName} avatarUrl={avatarUrl} labels={{ myLearning: copy.myLearning, settings: messages.account.settings, notifications: copy.notifications, signOut: messages.learning.signOut }} /> : null}
        </div>
      </div>
    </header>
  );
}

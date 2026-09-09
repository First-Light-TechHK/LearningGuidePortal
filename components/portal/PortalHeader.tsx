import Link from "next/link";
import { Suspense } from "react";
import { Bell } from "lucide-react";
import Image from "next/image";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { PortalLanguageLink } from "@/components/portal/PortalLanguageLink";
import { AccountMenu } from "@/components/portal/AccountMenu";

type HeaderSection = "courses" | "my-learning" | "pricing";

export function PortalHeader({ locale, active, signedIn = false, displayName, avatarUrl }: { locale: Locale; active?: HeaderSection; signedIn?: boolean; displayName?: string; avatarUrl?: string }) {
  const messages = getMessages(locale);
  const copy = messages.portal;
  const startHref = signedIn ? `/${locale}/account/my-learning` : `/${locale}/portal/sign-up`;

  return (
    <header className="portal-header">
      <div className="portal-header-inner">
        <Link prefetch={false} className="portal-brand" href={`/${locale}/portal`}>
          <span className="portal-brand-mark" aria-hidden="true"><Image src="/portal/figma-logo.svg" width={24} height={24} alt="" /></span>
          <span>{messages.brand}</span>
        </Link>
        <nav className="portal-nav" aria-label="Primary navigation">
          <Link prefetch={false} className={active === "courses" ? "active" : ""} href={`/${locale}/portal/courses`}>{copy.navigation.courses}</Link>
          <Link prefetch={false} href={`/${locale}/portal/faq`}>{copy.navigation.studyGroups}</Link>
          <Link prefetch={false} className={active === "pricing" ? "active" : ""} href={`/${locale}/pricing`}>{copy.navigation.pricing}</Link>
        </nav>
        <div className="portal-header-actions">
          <Suspense fallback={<span className="portal-language">{copy.navigation.language}</span>}><PortalLanguageLink locale={locale} label={copy.navigation.language} /></Suspense>
          {signedIn ? <Link prefetch={false} className="portal-header-link" href={`/${locale}/account/my-learning`}>{copy.myLearning}</Link> : <Link prefetch={false} className="portal-header-link" href={`/${locale}/portal/sign-in`}>{copy.signIn}</Link>}
          {signedIn ? <Link prefetch={false} className="portal-header-icon-link" href={`/${locale}/account/my-learning/notifications`} aria-label={copy.notifications}><Bell size={18} strokeWidth={1.8} /></Link> : null}
          {signedIn ? null : <Link prefetch={false} className="portal-button portal-button-primary portal-header-cta" href={startHref}>{copy.navigation.getStarted}</Link>}
          {signedIn ? <AccountMenu locale={locale} displayName={displayName} avatarUrl={avatarUrl} labels={{ myLearning: copy.myLearning, settings: messages.account.settings, notifications: copy.notifications, signOut: messages.learning.signOut }} /> : null}
        </div>
      </div>
    </header>
  );
}

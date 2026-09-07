import Link from "next/link";
import { Bell, ChevronDown, GraduationCap } from "lucide-react";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

type HeaderSection = "courses" | "my-learning" | "pricing";

export function PortalHeader({ locale, active, signedIn = false, displayName, avatarUrl }: { locale: Locale; active?: HeaderSection; signedIn?: boolean; displayName?: string; avatarUrl?: string }) {
  const messages = getMessages(locale);
  const copy = messages.portal;
  const startHref = signedIn ? `/${locale}/account/my-learning` : `/${locale}/portal/sign-up`;
  const otherLocale = locale === "en-GB" ? "zh-CN" : "en-GB";

  return (
    <header className="portal-header">
      <div className="portal-header-inner">
        <Link className="portal-brand" href={`/${locale}/portal`}>
          <span className="portal-brand-mark" aria-hidden="true"><GraduationCap size={22} strokeWidth={2.2} /></span>
          <span>{messages.brand}</span>
        </Link>
        <nav className="portal-nav" aria-label="Primary navigation">
          <Link className={active === "courses" ? "active" : ""} href={`/${locale}/portal/courses`}>{copy.navigation.courses}</Link>
          <Link href={`/${locale}/portal/faq`}>{copy.navigation.studyGroups}</Link>
          <Link className={active === "pricing" ? "active" : ""} href={`/${locale}/pricing`}>{copy.navigation.pricing}</Link>
        </nav>
        <div className="portal-header-actions">
          <Link className="portal-language" href={`/${otherLocale}/portal`} aria-label={locale === "en-GB" ? "切换到简体中文" : "Switch to English (UK)"}>
            <span>{copy.navigation.language}</span><ChevronDown size={13} aria-hidden="true" />
          </Link>
          {signedIn ? <Link className="portal-header-link" href={`/${locale}/account/my-learning`}>{copy.myLearning}</Link> : <Link className="portal-header-link" href={`/${locale}/portal/sign-in`}>{copy.signIn}</Link>}
          {signedIn ? <Link className="portal-header-icon-link" href={`/${locale}/account/my-learning/notifications`} aria-label={copy.notifications}><Bell size={18} strokeWidth={1.8} /></Link> : null}
          {signedIn ? null : <Link className="portal-button portal-button-primary portal-header-cta" href={startHref}>{copy.navigation.getStarted}</Link>}
          {signedIn ? <span className="portal-header-avatar" aria-hidden="true">{avatarUrl ? <img src={avatarUrl} alt="" /> : (displayName?.trim()[0] || "L").toUpperCase()}</span> : null}
        </div>
      </div>
    </header>
  );
}

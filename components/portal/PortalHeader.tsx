import Link from "next/link";
import { ChevronDown, GraduationCap } from "lucide-react";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

type HeaderSection = "courses" | "my-learning";

export function PortalHeader({ locale, active, signedIn = false }: { locale: Locale; active?: HeaderSection; signedIn?: boolean }) {
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
          <Link href={`/${locale}/portal/faq`}>{copy.navigation.inPerson}</Link>
          <Link href={`/${locale}/portal/faq`}>{copy.navigation.studyGroups}</Link>
        </nav>
        <div className="portal-header-actions">
          <Link className="portal-language" href={`/${otherLocale}/portal`} aria-label={locale === "en-GB" ? "切换到简体中文" : "Switch to English (UK)"}>
            <span>{copy.navigation.language}</span><ChevronDown size={13} aria-hidden="true" />
          </Link>
          {signedIn ? <Link className="portal-header-link" href={`/${locale}/account/my-learning`}>{copy.myLearning}</Link> : <Link className="portal-header-link" href={`/${locale}/portal/sign-in`}>{copy.signIn}</Link>}
          {signedIn ? null : <Link className="portal-button portal-button-primary portal-header-cta" href={startHref}>{copy.navigation.getStarted}</Link>}
          {signedIn ? <span className="portal-header-avatar" aria-hidden="true">K</span> : null}
        </div>
      </div>
    </header>
  );
}

import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { PortalLanguageLink } from "@/components/portal/PortalLanguageLink";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { StudyGroupSignInLink } from "./StudyGroupSignInLink";
import styles from "./study-groups.module.css";

export function StudyGroupHeader({ locale, signedIn, displayName }: { locale: Locale; signedIn: boolean; displayName?: string }) {
  const copy = getMessages(locale).portal;
  const page = getMessages(locale).studyGroupsPage;
  const initial = (displayName || "M").slice(0, 1).toUpperCase();
  const languageLabel = locale === "zh-CN" ? "zh" : "en";
  const links = (
    <>
      <Link href={`/${locale}/portal/courses`} prefetch={false}>{copy.navigation.courses}</Link>
      <Link className={styles.active} href={`/${locale}/portal/study-groups`} prefetch={false} aria-current="page">{copy.navigation.studyGroups}</Link>
      <a href={`/${locale}/subscription`}>{copy.navigation.pricing}</a>
    </>
  );
  return (
    <header className={styles.header}>
      {/* QA M23: phones hide the nav row; this compact menu keeps Courses and Subscription one tap away. */}
      <details className={styles.menu}>
        <summary aria-label={page.menu}><svg viewBox="0 0 16 16" width={16} height={16} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" /></svg></summary>
        <nav aria-label={page.primaryNavigation}>{links}</nav>
      </details>
      <Link className={styles.brand} href={`/${locale}/portal`} prefetch={false}>
        <Image src="/portal/study-groups/logo.svg" width={24} height={24} alt="" />
        {getMessages(locale).brand}
      </Link>
      <nav className={styles.nav} aria-label={page.primaryNavigation}>{links}</nav>
      <div className={styles.tools}>
        <Suspense fallback={<span className={styles.lang}>{languageLabel}</span>}>
          <PortalLanguageLink locale={locale} label={languageLabel} />
        </Suspense>
        {signedIn ? <Link href={`/${locale}/account/my-learning/notifications`} aria-label={copy.notifications}><Image className={styles.bell} src="/portal/study-groups/bell.svg" width={20} height={20} alt="" /></Link> : null}
        {signedIn ? <Link className={styles.avatar} href={`/${locale}/account/my-learning`} prefetch={false} aria-label={copy.myLearning}>{initial}</Link> : (
          <Suspense fallback={<Link className={styles.signInLink} href={`/${locale}/portal/sign-in`} prefetch={false}>{copy.signIn}</Link>}>
            <StudyGroupSignInLink locale={locale} className={styles.signInLink} label={copy.signIn} />
          </Suspense>
        )}
      </div>
    </header>
  );
}

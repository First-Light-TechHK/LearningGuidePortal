import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { PortalLanguageLink } from "@/components/portal/PortalLanguageLink";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import styles from "./study-groups.module.css";

export function StudyGroupHeader({ locale, signedIn, displayName }: { locale: Locale; signedIn: boolean; displayName?: string }) {
  const copy = getMessages(locale).portal;
  const initial = (displayName || "M").slice(0, 1).toUpperCase();
  return (
    <header className={styles.header}>
      <Link className={styles.brand} href={`/${locale}/portal`} prefetch={false}>
        <Image src="/portal/study-groups/logo.svg" width={24} height={24} alt="" />
        {getMessages(locale).brand}
      </Link>
      <nav className={styles.nav} aria-label="Primary navigation">
        <Link href={`/${locale}/portal/courses`} prefetch={false}>{copy.navigation.courses}</Link>
        <Link className="active" href={`/${locale}/portal/study-groups`} prefetch={false}>{copy.navigation.studyGroups}</Link>
        <Link href={`/${locale}/pricing`} prefetch={false}>{copy.navigation.pricing}</Link>
      </nav>
      <span className={styles.mark} aria-hidden="true" />
      <div className={styles.tools}>
        <Suspense fallback={<span className={styles.lang}>EN</span>}>
          <PortalLanguageLink locale={locale} label={locale === "zh-CN" ? "zh" : "en"} />
        </Suspense>
        {signedIn ? <Link href={`/${locale}/account/my-learning/notifications`} aria-label={copy.notifications}><Image className={styles.bell} src="/portal/study-groups/bell.svg" width={20} height={20} alt="" /></Link> : null}
        {signedIn ? <Link className={styles.avatar} href={`/${locale}/account/my-learning`} prefetch={false}>{initial}</Link> : <Link href={`/${locale}/portal/sign-in`}>{copy.signIn}</Link>}
      </div>
    </header>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getMessages } from "@/lib/i18n/messages";

export function AccountNav({ locale, copy }: { locale: "en-GB" | "zh-CN"; copy: { overview: string; subscription: string; notifications: string; settings: string; help: string } }) {
  const pathname = usePathname();
  const labels = getMessages(locale).account;
  const root = `/${locale}/account/my-learning`;
  const links = [[root, copy.overview], [`${root}/subscription`, copy.subscription], [`${root}/notifications`, copy.notifications], [`${root}/settings`, copy.settings], [`/${locale}/help`, copy.help]];
  return <nav className="account-nav" aria-label={labels.menu}><p className="account-nav-title">MY LEARNING</p>{links.map(([href, label]) => <Link prefetch={false} key={href} href={href} aria-current={pathname === href ? "page" : undefined}>{label}</Link>)}<div className="account-nav-support"><strong>{labels.contact}</strong><p>{labels.supportDescription}</p><Link prefetch={false} href={`/${locale}/contact`}>{labels.contactAction}</Link></div></nav>;
}
